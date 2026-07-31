import axios from 'axios';

const api = axios.create({
    // Use relative path - Vite proxy will forward /DocuWare/* to the DocuWare server
    baseURL: '/DocuWare/Platform',
    timeout: 30000,
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    }
});

// Add request interceptor to include auth token from session storage
api.interceptors.request.use(
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
                console.error('Error parsing auth data:', error);
            }
        }

        // Allow overriding target URL via config (useful for login/discovery)
        if (config.headers['x-target-url']) {
            targetUrl = config.headers['x-target-url'];
        }

        // Apply header if we have a target
        if (targetUrl) {
            config.headers['x-target-url'] = targetUrl;
        }

        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Import authService dynamically to avoid circular dependency issues if possible, 
// or simply assume we can import it. Since authService imports api, we might have a cycle.
// To avoid cycle, we'll keep it simple or inject it. 
// However, in ES modules, circular deps are often handled if we don't access immediately.
// But authService.js imports api.js invalidly for this pattern.
// Strategy: We will manually fetch the refresh token in the interceptor logic 
// OR simpler: Move the refresh logic to a utility or handle circular ref carefully.
// Let's rely on importing authService here. If it fails, we will see.
// Actually, let's fix the circular dependency by NOT importing authService at top level in api.js?
// No, authService uses api for login. api uses authService for refresh.
// We can use a lazy import or direct axios call in refresh.

// Let's modify the interceptor to import authService inside the function or just copy the refresh logic?
// Copying logic is cleaner to avoid circular deps.

// FIX CIRCULAR DEPENDENCY:
// api.js needs authService for refresh, but authService needs api for requests.
// Strategy: Dependency Injection. authService will inject itself into api.js.

let _authService = null;

export const injectAuthService = (service) => {
    _authService = service;
    console.log('[API] AuthService injected successfully');
};

let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
    failedQueue.forEach(prom => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve(token);
        }
    });
    failedQueue = [];
};

// Add response interceptor to handle 401 errors
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        if (error.response && error.response.status === 401 && !originalRequest._retry) {

            if (isRefreshing) {
                return new Promise(function (resolve, reject) {
                    failedQueue.push({ resolve, reject });
                }).then(token => {
                    originalRequest.headers['Authorization'] = 'Bearer ' + token;
                    return api(originalRequest);
                }).catch(err => {
                    return Promise.reject(err);
                });
            }

            originalRequest._retry = true;
            isRefreshing = true;

            try {
                if (!_authService) {
                    throw new Error('AuthService not injected in API interceptor');
                }

                console.log('[API] 401 detected. Attempting auto-refresh via injected AuthService...');

                // Call refresh
                const newToken = await _authService.refreshAccessToken();

                // Update header for this request
                api.defaults.headers.common['Authorization'] = 'Bearer ' + newToken;
                originalRequest.headers['Authorization'] = 'Bearer ' + newToken;

                // Retry queue
                processQueue(null, newToken);
                isRefreshing = false;

                return api(originalRequest);
            } catch (refreshErr) {
                console.error('[API] Auto-refresh failed:', refreshErr);
                processQueue(refreshErr, null);
                isRefreshing = false;
                // Logout done by authService
                return Promise.reject(refreshErr);
            }
        }
        return Promise.reject(error);
    }
);

export default api;
