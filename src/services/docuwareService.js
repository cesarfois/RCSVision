import api from './api';

/**
 * @file docuwareService.js
 * @description Core service layer for interacting with the DocuWare Platform API.
 * Handles authentication context, file cabinet operations, search queries, and document manipulation.
 * 
 * @module services/docuwareService
 */

export const docuwareService = {
    /**
     * @function getCabinets
     * @description Retrieves all File Cabinets accessible to the current user.
     * Maps to DocuWare resource: /FileCabinets
     * 
     * @returns {Promise<Array>} List of File Cabinet objects.
     */
    getCabinets: async () => {
        const response = await api.get('/FileCabinets');
        return response.data.FileCabinet || [];
    },

    /**
     * @function getCabinetFields
     * @description Fetches the schema/fields definition for a specific File Cabinet.
     * Uses a fallback strategy: tries root metadata first, then the dedicated /Fields endpoint.
     * 
     * @param {string} cabinetId - The UUID of the File Cabinet.
     * @returns {Promise<Array>} List of Field definitions (DBName, DisplayName, etc.).
     * @throws {Error} If cabinetId is missing.
     */
    getCabinetFields: async (cabinetId) => {
        if (!cabinetId) throw new Error("Cabinet ID is required");
        try {
            // Strategy 1: Check if fields are embedded in the cabinet root resource
            const response = await api.get(`/FileCabinets/${cabinetId}`);
            if (response.data && response.data.Fields) {
                return response.data.Fields;
            }

            // Strategy 2: Fallback to /Fields endpoint if not embedded
            console.warn(`Fields not found in cabinet root for ${cabinetId}, trying /Fields...`);
            try {
                const fieldRes = await api.get(`/FileCabinets/${cabinetId}/Fields`);
                if (fieldRes.data && fieldRes.data.Fields) {
                    return fieldRes.data.Fields;
                }
            } catch (fallbackErr) {
                console.warn("Fallback to /Fields failed:", fallbackErr);
            }

            return [];
        } catch (error) {
            console.error("Error in getCabinetFields:", error);
            throw error;
        }
    },

    /**
     * @function getCabinetCount
     * @description Gets the total number of documents in a cabinet.
     * Uses query param count=0 to avoid fetching actual items, optimizing performance.
     * 
     * @param {string} cabinetId - The UUID of the File Cabinet.
     * @returns {Promise<number>} Total document count.
     */
    getCabinetCount: async (cabinetId) => {
        try {
            const response = await api.get(`/FileCabinets/${cabinetId}/Documents`, {
                params: {
                    count: 0,
                    calculateTotalCount: true
                }
            });

            // Handle DocuWare response variations (sometimes Count is an object)
            if (typeof response.data.Count === 'object' && response.data.Count !== null) {
                return response.data.Count.Value || 0;
            }
            return response.data.Count || 0;
        } catch (error) {
            console.error('Error getting cabinet count:', error);
            return 0;
        }
    },

    /**
     * @function getDialogs
     * @description Retrieves all search and store dialogs for a cabinet.
     * Necessary to find the 'Search' dialog ID required for queries.
     * 
     * @param {string} cabinetId 
     * @returns {Promise<Array>} List of dialogs.
     */
    getDialogs: async (cabinetId) => {
        const response = await api.get(`/FileCabinets/${cabinetId}/Dialogs`);
        return response.data.Dialog || [];
    },

    /**
     * @function searchDocuments
     * @description Executes a specific query against the File Cabinet.
     * 
     * @param {string} cabinetId - Target Cabinet.
     * @param {Array<{fieldName: string, value: string}>} filters - Array of filter objects.
     * @param {number} [resultLimit=1000] - Max items to return.
     * @returns {Promise<{items: Array, total: number}>} Search results and total hits.
     */
    searchDocuments: async (cabinetId, filters = [], resultLimit = 1000) => {
        // Case 1: No filters - List all documents (limited by resultLimit)
        if (filters.length === 0) {
            const response = await api.get(`/FileCabinets/${cabinetId}/Documents`, {
                params: {
                    count: resultLimit,
                    calculateTotalCount: true
                }
            });

            const total = (typeof response.data.Count === 'object' && response.data.Count !== null)
                ? (response.data.Count.Value || 0)
                : (response.data.Count || 0);

            return {
                items: response.data.Items || [],
                total: total
            };
        }

        // Case 2: With Filters - Requires Search Dialog ID
        const dialogs = await docuwareService.getDialogs(cabinetId);
        const searchDialog = dialogs.find(d => d.Type === 'Search') || dialogs[0];

        if (!searchDialog) {
            throw new Error('No search dialog found for this cabinet');
        }

        // Construct standard DocuWare Query Object
        const conditions = filters.map(filter => ({
            DBName: filter.fieldName,
            Value: [filter.value],
            Operation: 'Equal' // Explicitly set operation
        }));

        const queryBody = {
            Condition: conditions,
            Operation: 'And', // Force strict AND logic
            CalculateTotalCount: true
        };

        console.log('[DocuWareService] Executing Search:', JSON.stringify(queryBody, null, 2));

        // HATEOAS Discovery
        const getLink = (relName) => searchDialog.Links?.find(l => (l.Rel || l.rel) === relName);
        const getHref = (link) => (link ? (link.Href || link.href || '') : '');

        const queryLink = getLink('Query');
        const countLink = getLink('count');

        let finalUrl = null;
        let useRawAxios = false;

        if (queryLink && getHref(queryLink)) {
            const href = getHref(queryLink);
            const match = href.match(/\/Platform(\/.*)/);
            finalUrl = (match && match[1]) ? match[1] : href;
        } else if (countLink && getHref(countLink)) {
            const href = getHref(countLink);
            console.log('[DocuWareService] Query link missing, deriving from count:', href);
            finalUrl = href.replace('CountExpression', 'DialogExpression');
            useRawAxios = true;
        } else {
            finalUrl = `/FileCabinets/${cabinetId}/Query/DialogExpression`;
        }

        console.log('[DocuWareService] Search URL:', finalUrl);

        let response;
        if (useRawAxios) {
            // Handle raw axios if needed (similar to admin service)
            // But docuwareService uses 'api' instance which has interceptors.
            // If finalUrl is absolute (from Search Service), 'api' might double-prefix if we are not careful.
            // The 'api' instance has baseURL='/DocuWare/Platform'.
            // If finalUrl is '/DocuWare/Search/...', we should use a raw request or ensure 'api' handles it.

            // Simplest: Check if it starts with /DocuWare/Search, if so, use absolute path (axios handles it? No, baseURL is prepended unless url is absolute?)
            // Axios treats absolute URLs by ignoring baseURL.

            // BUT, we are proxied. 
            // If finalUrl is 'http://.../DocuWare/Search', axios uses it.
            // We need to strip the configured proxy target? No, the browser requests localhost:5174/DocuWare/Search...

            // We'll stick to 'api.post' but we need to ensure we don't double path.
            // If finalUrl contains protocol, axios ignores baseURL.

            // If finalUrl comes from Href, it IS absolute.
            // We generally sanitized it in adminWorkflowService.

            // Let's rely on api instance but strip /Platform prefix if we sanitized it earlier.
            // Actually, simplest is to just pass the absolute URL from HATEOAS if useRawAxios is true?
            // No, browser cannot hit external absolute URL.

            // We matched /Platform in queryLink.
            // For countLink (Search Service), it might be /DocuWare/Search.
            // We can't proxy that easily via /DocuWare/Platform base.

            // So:
            // 1. If it's /DocuWare/Search, we need a new proxy route or use the existing generic proxy?
            // Vite config has: '/DocuWare': target: localhost:3001
            // So any /DocuWare/... works.
            // So we just need the path starting with /DocuWare...

            // If countLink.href is 'https://.../DocuWare/Search/...'
            // We strip protocol/domain.
            const relative = getHref(countLink).replace(/^https?:\/\/[^/]+/, '');
            finalUrl = relative.replace('CountExpression', 'DialogExpression');

            // Now finalUrl is /DocuWare/Search/...
            // api.post base is /DocuWare/Platform.
            // So /DocuWare/Platform/DocuWare/Search... -> WRONG.

            // SOLUTION: Use clean axios for this specific call to avoid baseURL prepending
            // Or construct a specific request.

            // Let's import axios directly? It is not imported in this file. 'api' is imported.
            // We can use api.post but we need to trick it?
            // No, let's use the 'api' instance but pass a full URL? No, that won't go through proxy correctly if domain differs from window.location.

            // If we pass a root-relative path '/DocuWare/Search...', axios with baseURL '/DocuWare/Platform' combines them?
            // No, usually if url starts with /, it's relative to root? No, relative to baseURL.

            // Let's assume standard behavior:
            // We need to temporarily bypass baseURL.

            // Better: Let's assume most envs are Platform.
            // If Search Service, we face the issue.
            // For now, let's just use the sanitized Platform path if available.
            // If using fallback, we might break.

            // Let's stick to the previous implementation (match /Platform) which is safe for 99%.
            // If countLink fallback is triggered, we should try to match /DocuWare/Search or /DocuWare/Platform.

            const href = getHref(countLink);
            // Try to extract relative path
            const relMatch = href.match(/(\/DocuWare\/.*)/);
            if (relMatch) {
                finalUrl = relMatch[1].replace('CountExpression', 'DialogExpression');
                // This gives /DocuWare/Search/...
            }
        }

        // Final Safety for api.post with baseURL
        // If finalUrl starts with /DocuWare/Platform, strip it because baseURL provides it.
        // If it starts with /DocuWare/Search, we have a problem with baseURL.

        if (finalUrl.startsWith('/DocuWare/Platform')) {
            finalUrl = finalUrl.replace('/DocuWare/Platform', '');
        }

        // If finalUrl is /DocuWare/Search..., and baseURL is /DocuWare/Platform...
        // We can't use 'api' instance easily if it enforces baseURL.
        // We might need to use `axios` directly if imported, or `api.request({ baseURL: '/' ... })`?

        const requestConfig = {
            params: {
                dialogId: searchDialog.Id,
                count: resultLimit
            }
        };

        // If we need to break out of baseURL
        if (finalUrl.startsWith('/DocuWare/Search')) {
            // Override baseURL for this request
            requestConfig.baseURL = '/';
        }

        response = await api.post(
            finalUrl,
            queryBody,
            requestConfig
        );

        const getCount = (data) => {
            if (typeof data.Count === 'object' && data.Count !== null) {
                return data.Count.Value || 0;
            }
            return data.Count || 0;
        };

        return {
            items: response.data.Items || [],
            total: getCount(response.data)
        };
    },

    /**
     * @function getSelectList
     * @description Retrieves unique values for a specific field (Select List).
     * Useful for populating autocomplete or dropdown filters.
     * 
     * @param {string} cabinetId 
     * @param {string} fieldName - DBName of the field.
     * @returns {Promise<Array<string>>} List of unique values.
     */
    getSelectList: async (cabinetId, fieldName) => {
        try {
            const dialogs = await docuwareService.getDialogs(cabinetId);
            const searchDialog = dialogs.find(d => d.Type === 'Search') || dialogs[0];

            if (!searchDialog) return [];

            // HATEOAS: Find the 'SelectList' link
            const selectListLink = searchDialog.Links.find(l => l.Rel === 'SelectList');

            let url;
            if (selectListLink && selectListLink.Href) {
                // Sanitization: Strip domain for Proxy compatibility
                // Match /FileCabinets/... or /Platform/...
                const match = selectListLink.Href.match(/\/Platform(\/.*)/);
                if (match && match[1]) {
                    url = match[1];
                } else {
                    // Fallback/Safety: If regex fails, use the hardcoded path
                    url = `/FileCabinets/${cabinetId}/Query/SelectListExpression`;
                }
            } else {
                // Fallback (risk of 404 if version differs)
                url = `/FileCabinets/${cabinetId}/Query/SelectListExpression`;
            }

            const response = await api.post(
                url,
                {
                    DialogId: searchDialog.Id,
                    FieldName: fieldName,
                    ExcludeExternalData: false
                },
                {
                    params: { dialogId: searchDialog.Id }
                }
            );

            return response.data.Value || [];
        } catch (error) {
            console.error("Failed to get select list:", error);
            return [];
        }
    },

    /**
     * @function getAllDocuments
     * @description Optimized Parallel Fetching for Analytics.
     * Breaking down a large valid dataset into parallel batches to speed up retrieval.
     * 
     * @param {string} cabinetId 
     * @param {function} onProgress - Callback(loaded, total)
     * @returns {Promise<Array>} Complete list of documents.
     */
    getAllDocuments: async (cabinetId, onProgress) => {
        try {
            console.log(`[Service] Starting optimized fetch for cabinet: ${cabinetId}`);

            // Pre-fetch fields definition to build a whitelist of necessary fields
            const allowedFields = new Set(['DWDOCID']);
            try {
                const fieldsDef = await docuwareService.getCabinetFields(cabinetId);
                if (Array.isArray(fieldsDef)) {
                    fieldsDef.forEach(f => {
                        const name = f.FieldName || f.DBFieldName || f.DBName;
                        if (name) {
                            if (name === 'DWDOCID' || (!f.SystemField && f.DWFieldType !== 'Memo' && f.ItemElementName !== 'Date')) {
                                allowedFields.add(name);
                            }
                        }
                    });
                    console.log(`[Service] Analytics fields whitelist initialized with ${allowedFields.size} fields`);
                }
            } catch (err) {
                console.warn("[Service] Could not pre-fetch fields definition, falling back to all fields", err);
            }

            // Step 1: Get total count first
            const totalCount = await docuwareService.getCabinetCount(cabinetId);
            console.log(`[Service] Total documents to fetch: ${totalCount}`);

            if (totalCount === 0) return [];

            if (onProgress) {
                onProgress(0, totalCount);
            }

            // Configuration for batching
            const CHUNK_SIZE = 2000; // Max items per request
            const BATCH_SIZE = 2; // Parallel requests (reduced to 2 to minimize concurrent memory spike)
            const TIMEOUT_MS = 120000;
            let allItems = [];
            let totalLoaded = 0;
            const starts = [];

            // Step 2: Calculate all start positions
            for (let start = 0; start < totalCount; start += CHUNK_SIZE) {
                starts.push(start);
            }

            console.log(`[Service] Plan: ${starts.length} requests in batches of ${BATCH_SIZE}`);

            // Step 3: Process in batches
            for (let i = 0; i < starts.length; i += BATCH_SIZE) {
                const currentBatchStarts = starts.slice(i, i + BATCH_SIZE);
                console.log(`[Service] Fetching batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(starts.length / BATCH_SIZE)} (Items ${currentBatchStarts[0]} - ${currentBatchStarts[currentBatchStarts.length - 1] + CHUNK_SIZE})...`);

                const batchPromises = currentBatchStarts.map(start =>
                    api.get(`/FileCabinets/${cabinetId}/Documents`, {
                        params: {
                            count: CHUNK_SIZE,
                            calculateTotalCount: false,
                            start: start
                        },
                        timeout: TIMEOUT_MS
                    }).then(response => {
                        const rawItems = response.data.Items || [];
                        totalLoaded += rawItems.length;
                        if (onProgress) onProgress(totalLoaded, totalCount);

                        // Map immediately to free memory of raw items (containing heavy links, sections, metadata)
                        return rawItems.map((item, index) => {
                            // Pre-resolve store date
                            let dateStr = item.DWStoreDateTime || item.StoreDateTime;
                            if (!dateStr && item.Fields) {
                                const dateField = item.Fields.find(f =>
                                    (f.DBName && f.DBName.toLowerCase() === 'dwstoredatetime') ||
                                    (f.FieldName && f.FieldName.toLowerCase() === 'dwstoredatetime')
                                );
                                if (dateField) dateStr = dateField.Item;
                            }

                             const simplified = {
                                Id: item.Id,
                                ContentType: item.ContentType,
                                DWStoreDateTime: dateStr,
                                FileSize: item.FileSize || item.fileSize || item.Length || item.dwdisksize || 0
                             };

                            if (item.Fields && Array.isArray(item.Fields)) {
                                item.Fields.forEach(f => {
                                    // Only keep fields that are in the allowed fields set (or copy all if whitelist fetch failed)
                                    if (allowedFields.size === 1 || allowedFields.has(f.FieldName)) {
                                        simplified[f.FieldName] = f.Item || f.ItemElementName || 'Unknown';
                                    }
                                });

                                // Keep Fields list only on the first item of the whole dataset
                                // to allow field schema discovery in AnalyticsContainer,
                                // saving massive memory overhead across 130k+ items.
                                if (start === 0 && index === 0) {
                                    simplified.Fields = item.Fields.map(f => ({
                                        FieldName: f.FieldName,
                                        FieldLabel: f.FieldLabel,
                                        DWFieldType: f.DWFieldType,
                                        SystemField: f.SystemField,
                                        ItemElementName: f.ItemElementName,
                                        Item: f.Item
                                    }));
                                }
                            }

                            return simplified;
                        });
                    })
                        .catch(err => {
                            console.error(`[Service] Failed to fetch chunk starting at ${start}`, err);
                            return [];
                        })
                );

                const batchResults = await Promise.all(batchPromises);

                batchResults.forEach(items => {
                    allItems = [...allItems, ...items];
                });
            }

            console.log(`[Service] Fetch complete. Total loaded: ${allItems.length}`);
            return allItems;
        } catch (error) {
            console.error('Error fetching all items for analytics:', error);
            throw error;
        }
    },

    /**
     * @function getDocumentViewUrl
     * @description Generates a direct link to the DocuWare Viewer.
     * 
     * @param {string} cabinetId 
     * @param {string} documentId 
     * @returns {string} URL to open document in new tab.
     */
    getDocumentViewUrl: (cabinetId, documentId) => {
        // Get the base URL from session storage to support multi-tenant
        const authData = sessionStorage.getItem('docuware_auth');
        let baseUrl = 'https://rcsangola.docuware.cloud'; // Default fallback
        let orgId = 'bcb91903-58eb-49c6-8572-be5e3bb9611e'; // Default org ID

        if (authData) {
            try {
                const parsed = JSON.parse(authData);
                baseUrl = parsed.url;
                if (parsed.organizationId) {
                    orgId = parsed.organizationId;
                }
            } catch (e) {
                console.error('Error parsing auth data:', e);
            }
        }

        // URL Pattern: /DocuWare/Platform/WebClient/{orgId}/Integration?fc={cabinetId}&did={docId}&p=V
        return `${baseUrl}/DocuWare/Platform/WebClient/${orgId}/Integration?fc=${cabinetId}&did=${documentId}&p=V`;
    },

    /**
     * @function downloadDocument
     * @description Downloads the binary content of a document.
     * 
     * @param {string} cabinetId 
     * @param {string} documentId 
     * @returns {Promise<Blob>} The file blob (usually PDF).
     */
    downloadDocument: async (cabinetId, documentId) => {
        const response = await api.get(
            `/FileCabinets/${cabinetId}/Documents/${documentId}/FileDownload`,
            {
                params: {
                    targetFileType: 'pdf', // Convert to PDF on the fly if needed
                    keepAnnotations: true // Preserve stamps and notes
                },
                responseType: 'blob',
                timeout: 120000
            }
        );
        return response.data;
    },

    /**
     * @function uploadReplacement
     * @description Replaces a document's content with a new file.
     * CRITICAL: DocuWare does not support "simple replace". 
     * We must (1) Append new section, (2) Delete old sections.
     * 
     * @param {string} cabinetId 
     * @param {string} documentId 
     * @param {Blob} fileBlob - The compressed/modified file.
     * @returns {Promise<Object>} Updated document metadata.
     */
    uploadReplacement: async (cabinetId, documentId, fileBlob) => {
        console.log(`[uploadReplacement] Starting overwrite for doc ${documentId} in cabinet ${cabinetId}`);

        try {
            // Step 1: Fetch the current document state to identify ALL existing sections
            const docResponse = await api.get(`/FileCabinets/${cabinetId}/Documents/${documentId}`);
            const originalDoc = docResponse.data;
            const originalSections = originalDoc.Sections || [];

            console.log(`[uploadReplacement] Found ${originalSections.length} existing sections to replace.`);

            // Step 2: Append the NEW file as a fresh section
            // We use POST to /Sections to append.
            const appendUrl = `/FileCabinets/${cabinetId}/Sections?docId=${documentId}`;
            console.log(`[uploadReplacement] Appending new file via: ${appendUrl}`);

            await api.post(
                appendUrl,
                fileBlob,
                {
                    headers: {
                        'Content-Type': fileBlob.type || 'application/pdf',
                        'Content-Disposition': `inline; filename="${fileBlob.name || 'reduced_document.pdf'}"`
                    },
                    timeout: 120000
                }
            );
            console.log('[uploadReplacement] New file appended successfully.');

            // Step 3: Delete ALL original sections
            // We must be careful not to delete the new section we just added.
            // Since we captured 'originalSections' BEFORE the append, we are safe to delete exactly those IDs.
            if (originalSections.length > 0) {
                console.log('[uploadReplacement] Deleting old sections...');

                for (const section of originalSections) {
                    const deleteUrl = `/FileCabinets/${cabinetId}/Sections/${section.Id}`;
                    console.log(`[uploadReplacement] Deleting old section: ${section.Id}`);

                    try {
                        await api.delete(deleteUrl);
                    } catch (delErr) {
                        console.error(`[uploadReplacement] Failed to delete section ${section.Id}`, delErr);
                        // Continue even if one fails
                    }
                }
                console.log('[uploadReplacement] All old sections deleted.');
            } else {
                console.log('[uploadReplacement] No old sections found (strange for a replacement, but proceeding).');
            }

            // Step 4: Return final state
            const finalDocResponse = await api.get(`/FileCabinets/${cabinetId}/Documents/${documentId}`);
            return finalDocResponse.data;

        } catch (error) {
            console.error('[uploadReplacement] Critical Error during overwrite:', error);
            throw error;
        }
    },

    /**
     * @function updateDocumentFields
     * @description Updates specific index fields (metadata) for a document.
     * 
     * @param {string} cabinetId 
     * @param {string} documentId 
     * @param {string} fieldName - DBName of the field.
     * @param {string} value - New value to set.
     * @returns {Promise<Object>} Response data.
     */
    updateDocumentFields: async (cabinetId, documentId, fieldName, value) => {
        console.log(`[updateDocumentFields] Updating ${fieldName} = ${value} for doc ${documentId}`);

        // Construct standard DocuWare field structure
        const body = {
            Field: [
                {
                    FieldName: fieldName,
                    Item: value,
                    ItemElementName: 'String' // Assuming string type for now, can be dynamic
                }
            ]
        };

        const response = await api.put(
            `/FileCabinets/${cabinetId}/Documents/${documentId}/Fields`,
            body
        );
        return response.data;
    }
};
