import axios from 'axios';

/**
 * Admin Workflow Service - Administrative Access using Power Automate API Key
 * 
 * This service provides UNRESTRICTED access to ALL DocuWare workflows for
 * administrative monitoring purposes. It uses a dedicated Power Automate API Key
 * instead of the logged-in user's token to provide a global view.
 * 
 * IMPORTANT: This is separate from workflowService.js which uses user authentication.
 */

// Create a dedicated axios instance for admin workflow API
const adminWorkflowApi = axios.create({
    baseURL: '/DocuWare/Platform/Workflow',
    timeout: 30000,
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    }
});

// Create a dedicated axios instance for Platform API (Admin/Proxy Context)
const adminPlatformApi = axios.create({
    baseURL: '/DocuWare/Platform',
    timeout: 30000,
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    }
});

// Add request interceptor for Platform API (Mirroring adminWorkflowApi logic)
adminPlatformApi.interceptors.request.use(
    (config) => {
        const authData = sessionStorage.getItem('docuware_auth');
        let targetUrl = null;

        if (authData) {
            try {
                const parsed = JSON.parse(authData);
                if (parsed.token) {
                    config.headers.Authorization = `Bearer ${parsed.token}`;
                }
                if (parsed.url) {
                    targetUrl = parsed.url;
                }
            } catch (error) {
                console.error('[AdminPlatformApi] Error parsing auth data:', error);
            }
        }

        // Use environment variable fallback if needed
        if (!targetUrl) {
            targetUrl = import.meta.env.VITE_DOCUWARE_ADMIN_URL || import.meta.env.VITE_DOCUWARE_WORKFLOW_URL;
        }

        if (targetUrl) {
            // Fix for Proxy Path Duplication:
            // The request URL (baseURL + endpoint) already includes /DocuWare/Platform.
            // If the target URL also ends with /DocuWare/Platform, the proxy may double it.
            // We strip it here to point to the server root.
            targetUrl = targetUrl.replace(/\/DocuWare\/Platform\/?$/i, '');
            config.headers['x-target-url'] = targetUrl;
        }

        return config;
    },
    (error) => Promise.reject(error)
);

// Add request interceptor to include User Token from Session Storage
// This avoids the 1-hour expiration limit of the API Key
adminWorkflowApi.interceptors.request.use(
    (config) => {
        const authData = sessionStorage.getItem('docuware_auth');
        let targetUrl = null;

        if (authData) {
            try {
                const parsed = JSON.parse(authData);
                if (parsed.token) {
                    config.headers.Authorization = `Bearer ${parsed.token}`;
                    console.log('[AdminWorkflowService] Using user token for admin access');
                }
                if (parsed.url) {
                    targetUrl = parsed.url;
                }
            } catch (error) {
                console.error('[AdminWorkflowService] Error parsing auth data:', error);
            }
        } else {
            console.warn('[AdminWorkflowService] No user logged in');
        }

        // Allow overriding target URL (e.g. from .env if needed, but prefer user session)
        if (!targetUrl) {
            targetUrl = import.meta.env.VITE_DOCUWARE_ADMIN_URL || import.meta.env.VITE_DOCUWARE_WORKFLOW_URL;
        }

        // Set target URL for proxy
        // Set target URL for proxy
        if (targetUrl) {
            // Fix for Proxy Path Duplication:
            // AdminWorkflowApi uses /DocuWare/Platform/Workflow as base.
            // We must strip the base path from the target URL to avoid duplication.
            targetUrl = targetUrl.replace(/\/DocuWare\/Platform\/?$/i, '');
            config.headers['x-target-url'] = targetUrl;
        }

        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Add response interceptor for error handling
adminWorkflowApi.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response && error.response.status === 401) {
            console.error('❌ Admin API authentication failed - User token may be expired');
        }
        return Promise.reject(error);
    }
);

export const adminWorkflowService = {
    /**
     * Get ALL workflows with administrative access
     * Uses /ControllerWorkflows endpoint which requires Admin permissions
     * @returns {Promise<Array>} Array of ALL workflow objects
     */
    getWorkflows: async () => {
        try {
            console.log('[AdminWorkflowService] Fetching ALL workflows with PAGINATION...');

            // Helper function to fetch all pages from an endpoint
            const fetchAllPages = async (endpointBase) => {
                let allItems = [];
                let start = 0;
                const count = 1000; // Reasonable page size
                let hasMore = true;
                let page = 1;

                while (hasMore) {
                    try {
                        const separator = endpointBase.includes('?') ? '&' : '?';
                        const url = `${endpointBase}${separator}Count=${count}&Start=${start}`;

                        console.log(`[AdminWorkflowService] Fetching page ${page} from ${endpointBase}...`);
                        const response = await adminWorkflowApi.get(url);

                        const items = response.data.Workflow || [];

                        if (items.length > 0) {
                            allItems = [...allItems, ...items];
                            start += items.length;
                            page++;

                            // If we got fewer items than requested, we reached the end
                            if (items.length < count) {
                                hasMore = false;
                            }
                        } else {
                            hasMore = false;
                        }
                    } catch (error) {
                        console.warn(`[AdminWorkflowService] Error fetching page ${page} from ${endpointBase}:`, error.message);

                        // Critical fix: If the first page fails, THROW so useQuery knows it failed.
                        // Otherwise it caches [] as a success.
                        if (page === 1) {
                            throw error;
                        }

                        hasMore = false;
                    }
                }
                return allItems;
            };

            // Fetch from all relevant endpoints
            const [controllerWorkflows, standardWorkflows, designerWorkflows] = await Promise.all([
                fetchAllPages('/ControllerWorkflows'),
                fetchAllPages('/Workflows'),
                fetchAllPages('/DesignerWorkflows')
            ]);

            console.log(`[AdminWorkflowService] Controller Endpoint: Found ${controllerWorkflows.length}`);
            console.log(`[AdminWorkflowService] Standard Endpoint: Found ${standardWorkflows.length}`);
            console.log(`[AdminWorkflowService] Designer Endpoint: Found ${designerWorkflows.length}`);

            // DEBUG: Check if DesignerWorkflows has FileCabinetId
            if (designerWorkflows.length > 0) {
                console.log('[AdminWorkflowService] 🔍 Sample Designer Workflow:', JSON.stringify(designerWorkflows[0], null, 2));
            }

            // Merge and accumulate properties by ID
            const workflowMap = new Map();

            // Order matters: Designer last because it often has better metadata (Names)
            [...controllerWorkflows, ...standardWorkflows, ...designerWorkflows].forEach(wf => {
                const existing = workflowMap.get(wf.Id) || {};

                // Merge strategies:
                // 1. Accumulate all keys
                // 2. Preserve Name if existing has it and new one doesn't

                const merged = { ...existing, ...wf };

                if (existing.Name && !wf.Name) {
                    merged.Name = existing.Name;
                }

                workflowMap.set(wf.Id, merged);
            });

            const allWorkflows = Array.from(workflowMap.values());
            console.log(`[AdminWorkflowService] ✅ Total Unique Workflows Merged: ${allWorkflows.length}`);

            return allWorkflows;

        } catch (error) {
            console.error('[AdminWorkflowService] Error fetching admin workflows:', error);
            throw new Error(`Falha ao buscar workflows administrativos. Verifique se seu usuário tem permissão de administrador.\nErro: ${error.message}`);
        }
    },

    /**
     * Get File Cabinet name by ID
     * @param {string} fileCabinetId - The file cabinet GUID
     * @returns {Promise<string|null>} File Cabinet name or null
     */
    /**
     * Get ALL File Cabinets (for mapping IDs to Names)
     * @returns {Promise<Object>} Map of ID -> Name
     */
    getFileCabinetMap: async () => {
        try {
            const authData = JSON.parse(sessionStorage.getItem('docuware_auth') || '{}');
            const token = authData.token;
            const targetUrl = authData.url;

            if (!token || !targetUrl) {
                console.warn('[AdminWorkflowService] Missing auth data for FC map');
                return {};
            }

            // Fetch all file cabinets from Platform
            const response = await axios.get('/DocuWare/Platform/FileCabinets', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json',
                    'x-target-url': targetUrl // CRITICAL: Required by Proxy
                }
            });

            // Create Map: ID -> Name
            const fcMap = {};
            if (response.data && response.data.FileCabinet) {
                response.data.FileCabinet.forEach(fc => {
                    fcMap[fc.Id] = fc.Name;
                });
            }

            console.log(`[AdminWorkflowService] Loaded ${Object.keys(fcMap).length} file cabinets for mapping`);
            return fcMap;
        } catch (error) {
            console.warn(`[AdminWorkflowService] Failed to load File Cabinets: ${error.message}`);
            // THROW the error so React Query knows it failed and doesn't cache {} as success
            throw error;
        }
    },

    // Deprecated: Single fetch replaced by bulk map
    getFileCabinetName: async (fileCabinetId) => {
        return null;
    },

    /**
     * Get detailed information about a specific workflow including File Cabinet ID
     * @param {string} workflowId - The workflow ID
     * @returns {Promise<Object>} Workflow details with FileCabinetId and FileCabinetName
     */
    getWorkflowDetails: async (workflowId) => {
        try {
            console.log(`[AdminWorkflowService] Fetching details for workflow ${workflowId}...`);

            // Get workflow details
            const response = await adminWorkflowApi.get(`/DesignerWorkflows/${workflowId}`);

            // Extract File Cabinet ID
            const fileCabinetId = response.data.FileCabinetId || null;

            // Name will be mapped in the frontend using the bulk Map
            // console.log(`[AdminWorkflowService] ✅ Workflow ${workflowId} → FC ID: ${fileCabinetId}`);

            return {
                ...response.data,
                FileCabinetId: fileCabinetId
            };
        } catch (error) {
            console.warn(`[AdminWorkflowService] Failed to get details for workflow ${workflowId}:`, error.message);
            return null;
        }
    },

    /**
     * Get active tasks/instances for a specific workflow (admin access)
     * WITH PAGINATION to handle workflows with >50 tasks
     * @param {string} workflowId - The workflow ID
     * @returns {Promise<Array>} Array of task objects
     */
    getWorkflowTasks: async (workflowId) => {
        let allTasks = [];
        try {
            console.log(`[AdminWorkflowService] Fetching tasks for workflow ${workflowId}...`);

            let nextLink = `/ControllerWorkflows/${workflowId}/Tasks`;
            let pageCount = 0;
            const maxPages = 500; // Cap at 250k tasks
            const PAGE_SIZE = 500; // Smaller chunks for reliability

            // Request parameters
            let params = { Count: PAGE_SIZE };

            while (nextLink && pageCount < maxPages) {
                pageCount++;

                // Determine request URL
                let requestUrl = nextLink;

                // If nextLink is absolute (from Link header), extract relative path carefully
                if (nextLink.toLowerCase().startsWith('http') || nextLink.startsWith('/')) {
                    const keywords = ['/ControllerWorkflows', '/Workflows'];
                    let relativePath = null;

                    for (const kw of keywords) {
                        const idx = nextLink.toLowerCase().indexOf(kw.toLowerCase());
                        if (idx !== -1) {
                            relativePath = nextLink.substring(idx);
                            break;
                        }
                    }
                    if (relativePath) requestUrl = relativePath;
                }

                // Make request
                const response = await adminWorkflowApi.get(requestUrl, { params });
                const tasks = response.data.Task || [];

                if (tasks.length === 0) {
                    break;
                }

                allTasks = [...allTasks, ...tasks];
                console.log(`[AdminWorkflowService] Page ${pageCount} (WF: ${workflowId}) +${tasks.length} tasks. Total: ${allTasks.length}`);

                // Check for next link
                const links = response.data.Link || response.data.Links;
                let foundNext = false;

                if (links && Array.isArray(links)) {
                    const nextLinkObj = links.find(l => l.Rel && l.Rel.toLowerCase() === 'next');
                    if (nextLinkObj) {
                        nextLink = nextLinkObj.Href;
                        params = {}; // Clear params as link has them
                        foundNext = true;
                    }
                }

                // Fallback: If no next link but page is full, try manual pagination
                if (!foundNext) {
                    if (tasks.length === PAGE_SIZE) {
                        console.log(`[AdminWorkflowService] ⚠️ No 'next' link but page full. Attempting manual pagination from ${allTasks.length}...`);
                        // Construct manual next link
                        nextLink = `/ControllerWorkflows/${workflowId}/Tasks?Start=${allTasks.length}&Count=${PAGE_SIZE}`;
                        params = {}; // Using URL params
                    } else {
                        nextLink = null; // Done
                    }
                }
            }

            console.log(`[AdminWorkflowService] ✅ Finished fetching ${allTasks.length} tasks for ${workflowId}`);
            return allTasks;

        } catch (error) {
            console.warn(`[AdminWorkflowService] Error fetching tasks for ${workflowId} (Retrieved ${allTasks.length}):`, error.message);
            // Return what we have so far instead of empty
            return allTasks.length > 0 ? allTasks : [];
        }
    },

    /**
     * Get lightweight index of all workflows (ID + Name only)
     * Optimized for fast initial load and search
     * @returns {Promise<Array<{id: string, name: string}>>}
     */
    getWorkflowIndex: async () => {
        const workflows = await adminWorkflowService.getWorkflows();
        return workflows.map(wf => ({
            id: wf.Id,
            name: wf.Name || wf.Id || 'Unnamed Workflow'
        })).sort((a, b) => a.name.localeCompare(b.name));
    },

    /**
     * Get ALL workflows with their active instance counts (admin access)
     * @param {AbortSignal} [signal] - Optional abort signal to cancel the operation
     * @param {Function} [progressCallback] - Optional callback(current, total) for progress updates
     * @returns {Promise<Array>} Array of ALL workflow objects with counts
     */
    getWorkflowsWithCounts: async (signal, progressCallback = null) => {
        try {
            console.log('[AdminWorkflowService] Fetching ALL workflows with instance counts (ADMIN ACCESS)...');

            // Step 1: Get all workflows
            const workflows = await adminWorkflowService.getWorkflows();

            if (workflows.length === 0) {
                console.log('[AdminWorkflowService] No workflows found');
                return [];
            }

            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

            // Step 2: Fetch task counts for all workflows with concurrency control
            // We have 166+ workflows, firing all requests at once causes timeouts
            console.log(`[AdminWorkflowService] Fetching task counts for ${workflows.length} workflows...`);

            const CONCURRENCY_LIMIT = 10; // Increased from 5 to 10 for faster loading
            const results = [];

            // Process workflows in chunks to avoid overwhelming the server/browser
            for (let i = 0; i < workflows.length; i += CONCURRENCY_LIMIT) {
                if (signal?.aborted) {
                    console.log('[AdminWorkflowService] Operation cancelled by user/system.');
                    throw new DOMException('Aborted', 'AbortError');
                }

                const chunk = workflows.slice(i, i + CONCURRENCY_LIMIT);
                const chunkNumber = Math.floor(i / CONCURRENCY_LIMIT) + 1;
                const totalChunks = Math.ceil(workflows.length / CONCURRENCY_LIMIT);

                console.log(`[AdminWorkflowService] Processing chunk ${chunkNumber}/${totalChunks}`);

                // Report progress
                if (progressCallback) {
                    progressCallback(i, workflows.length);
                }

                const chunkResults = await Promise.all(
                    chunk.map(async (workflow) => {
                        try {
                            const tasks = await adminWorkflowService.getWorkflowTasks(workflow.Id);
                            return {
                                id: workflow.Id,
                                name: workflow.Name || workflow.Id,
                                description: workflow.Description || '',
                                activeInstanceCount: tasks.length
                            };
                        } catch (error) {
                            console.error(`[AdminWorkflowService] Failed to get count for workflow ${workflow.Id}:`, error);
                            return {
                                id: workflow.Id,
                                name: workflow.Name || workflow.Id,
                                description: workflow.Description || '',
                                activeInstanceCount: 0
                            };
                        }
                    })
                );

                results.push(...chunkResults);
            }

            console.log('[AdminWorkflowService] ✅ Successfully fetched all workflow counts (ADMIN)');
            return results;
        } catch (error) {
            console.error('[AdminWorkflowService] Error fetching workflows with counts:', error);
            throw error;
        }
    },

    /**
     * Get task counts for specific workflow IDs (selective loading)
     * @param {Array<string>} workflowIds - Array of workflow IDs to load
     * @param {Function} progressCallback - Optional callback(workflowId, count, current, total)
     * @returns {Promise<Object>} Map of workflowId -> count
     */
    getWorkflowTaskCounts: async (workflowIds, progressCallback = null) => {
        try {
            console.log(`[AdminWorkflowService] Loading task counts for ${workflowIds.length} selected workflows...`);

            const results = {};
            const total = workflowIds.length;

            // Process with concurrency control
            const CONCURRENCY_LIMIT = 5;

            for (let i = 0; i < workflowIds.length; i += CONCURRENCY_LIMIT) {
                const chunk = workflowIds.slice(i, i + CONCURRENCY_LIMIT);

                const chunkResults = await Promise.all(
                    chunk.map(async (workflowId, chunkIndex) => {
                        try {
                            const tasks = await adminWorkflowService.getWorkflowTasks(workflowId);
                            const count = tasks.length;

                            // Report progress
                            if (progressCallback) {
                                const current = i + chunkIndex + 1;
                                progressCallback(workflowId, count, current, total);
                            }

                            return { workflowId, count };
                        } catch (error) {
                            console.error(`[AdminWorkflowService] Failed to load tasks for ${workflowId}:`, error);
                            return { workflowId, count: 0 };
                        }
                    })
                );

                // Add to results map
                chunkResults.forEach(({ workflowId, count }) => {
                    results[workflowId] = count;
                });
            }

            console.log(`[AdminWorkflowService] ✅ Loaded task counts for ${workflowIds.length} workflows`);
            return results;

        } catch (error) {
            console.error('[AdminWorkflowService] Error loading task counts:', error);
            throw error;
        }
    },

    /**
     * Get Workflow History for a specific document
     * @param {string} cabinetId 
     * @param {string} docId 
     * @returns {Promise<Array>} List of history events
     */
    getWorkflowHistory: async (cabinetId, docId) => {
        try {
            // GET /FileCabinets/{CabinetID}/Documents/{DocID}/WorkflowHistory
            const response = await adminPlatformApi.get(`/FileCabinets/${cabinetId}/Documents/${docId}/WorkflowHistory`);
            return response.data.WorkflowHistoryItem || [];
        } catch (error) {
            console.warn(`[AdminWorkflowService] Failed to get history for doc ${docId}:`, error.message);
            return [];
        }
    },

    /**
     * Fetch documents modified within a date range for a specific cabinet.
     * Used for Monthly Performance Reports.
     * @param {string} cabinetId 
     * @param {Date} startDate 
     * @param {Date} endDate 
     * @param {string} [docType] - Optional: Filter by specific DWDOCUMENTTYPE
     * @returns {Promise<Array>} List of documents (lightweight)
     */
    getDocumentsByDateRange: async (cabinetId, startDate, endDate, docType = null) => {
        try {
            console.log(`[AdminWorkflowService] Searching docs in ${cabinetId} from ${startDate.toISOString()} to ${endDate.toISOString()} ${docType ? `(Type: ${docType})` : ''}`);

            // We need the Search Dialog ID first
            const dialogRes = await adminPlatformApi.get(`/FileCabinets/${cabinetId}/Dialogs`);

            // DEBUG: List all dialogs to see what we have
            const allDialogs = dialogRes.data.Dialog || [];
            console.log(`[AdminWorkflowService] Found ${allDialogs.length} dialogs for cabinet ${cabinetId}:`, allDialogs.map(d => `${d.Type} (${d.Id})`));

            const searchDialog = allDialogs.find(d => d.Type === 'Search');

            if (!searchDialog) {
                console.error('[AdminWorkflowService] No Search dialog found!');
                throw new Error('Search dialog not found');
            }

            console.log('[AdminWorkflowService] Selected Search Dialog:', JSON.stringify(searchDialog, null, 2));

            // HATEOAS: Find the 'Query' link

            // HATEOAS Strategy:
            // 1. Try 'Query' link (Standard Platform).
            // 2. If missing, try 'Count' link and replace 'CountExpression' with 'DialogExpression' (Search Service).
            // 3. Fallback to constructed Platform path.

            // Fix property casing: some versions use 'rel'/'href', others 'Rel'/'Href'
            const getLink = (relName) => searchDialog.Links?.find(l => (l.Rel || l.rel) === relName);

            const queryLink = getLink('Query');
            const countLink = getLink('count');

            let finalUrl = null;
            let useRawAxios = false;

            // Helper to get href safely
            const getHref = (link) => (link ? (link.Href || link.href || '') : '');

            if (queryLink && getHref(queryLink)) {
                const href = getHref(queryLink);
                // Use Query link, strip domain
                const match = href.match(/\/Platform(\/.*)/);
                finalUrl = (match && match[1]) ? match[1] : href;
            } else if (countLink && getHref(countLink)) {
                const href = getHref(countLink);
                // FALLBACK: Derive from Count link (e.g. /DocuWare/Search/.../CountExpression)
                console.log('[AdminWorkflowService] Query link missing, using Count link pattern:', href);
                finalUrl = href.replace('CountExpression', 'DialogExpression');
                useRawAxios = true;
            } else {
                // ABSOLUTE FALLBACK
                finalUrl = `/FileCabinets/${cabinetId}/Query/DialogExpression`;
            }

            console.log(`[AdminWorkflowService] Final Query URL: ${finalUrl} (RawAxios: ${useRawAxios})`);

            // Construct Query: DWLastModified OR DWWorkflowDate between dates
            const conditions = [
                {
                    DBName: 'DWLastModified',
                    Value: [startDate.toISOString(), endDate.toISOString()],
                    Operation: 'Between'
                }
            ];

            // Add DocType filter if provided
            if (docType) {
                conditions.push({
                    DBName: 'DOCUMENT_TYPE', // Using standard system name based on prompt "Tipo Documental"
                    Value: [docType],
                    Operation: 'Equal'
                });
            }

            const query = {
                Condition: conditions,
                Operation: 'And'
            };

            let response;
            if (useRawAxios) {
                // Manually construct request to handle /DocuWare/Search or other paths
                const authData = sessionStorage.getItem('docuware_auth');
                const parsedAuth = authData ? JSON.parse(authData) : {};

                // Ensure we hit the proxy root
                // finalUrl is likely /DocuWare/Search/...
                // Our proxy listens on localhost:5173/DocuWare/...

                // Fix targetUrl (strip internal /DocuWare/Platform suffix if present in stored url)
                let targetHost = parsedAuth.url || '';
                targetHost = targetHost.replace(/\/DocuWare\/Platform\/?$/i, '');

                response = await axios.post(finalUrl, query, {
                    headers: {
                        'Authorization': `Bearer ${parsedAuth.token}`,
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'x-target-url': targetHost
                    },
                    params: {
                        dialogId: searchDialog.Id,
                        count: 1000
                    }
                });
            } else {
                // Use standard Platform API
                response = await adminPlatformApi.post(finalUrl, query, {
                    params: {
                        dialogId: searchDialog.Id,
                        count: 1000
                    }
                });
            }

            return response.data.Items || [];

        } catch (error) {
            console.error('[AdminWorkflowService] Date range search failed:', error);
            throw error;
        }
    },

    /**
     * Helper for debugging - raw GET request
     */
    getRaw: async (url) => {
        return await adminWorkflowApi.get(url);
    }
};
