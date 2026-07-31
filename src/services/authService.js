import axios from 'axios';
import api, { injectAuthService } from './api';

const AUTH_KEY = 'docuware_auth';

// In-Memory Credential Cache (cleared on page refresh/close)
let cachedCredentials = null;

export const authService = {
    // 1. Login Function
    login: async (url, username, password) => {
        try {
            // Normalize URL (remove trailing slash and ensure https for cloud)
            let baseUrl = url.replace(/\/$/, '').trim();

            // Force HTTPS for DocuWare Cloud URLs
            if (baseUrl.includes('.docuware.cloud') && baseUrl.startsWith('http://')) {
                baseUrl = baseUrl.replace('http://', 'https://');
                console.warn('Automatically converted HTTP to HTTPS for DocuWare Cloud');
            }

            // Note: We keep baseURL as /DocuWare/Platform (proxy handles the rest)
            // We just store the user's URL for reference

            // Step 1: Get Identity Service URL
            console.log('Step 1: Getting Identity Service Info...');
            // Pass the target URL in the header so the proxy knows where to go
            const serviceDesc = await api.get('/Home/IdentityServiceInfo', {
                headers: { 'x-target-url': baseUrl }
            });
            const identityUrl = serviceDesc.data.IdentityServiceUrl;
            console.log('Identity Service URL:', identityUrl);

            // Extract only the path part of the Identity URL (e.g. /bcb... )
            const identityPath = new URL(identityUrl).pathname;
            const identityOrigin = new URL(identityUrl).origin; // We need the origin for the proxy target

            // Extract organization ID from the identity URL path
            // Format: /bcb91903-58eb-49c6-8572-be5e3bb9611e
            const orgId = identityPath.replace(/^\//, ''); // Remove leading slash
            console.log('Organization ID:', orgId);

            // Step 2: Get Token Endpoint from OpenID Configuration (via proxy to avoid CORS)
            console.log('Step 2: Getting OpenID Configuration...');
            const proxiedIdentity = `/docuware-proxy${identityPath}`;
            // Identity service might be on a different subdomain, so we pass its origin as target
            const discovery = await axios.get(`${proxiedIdentity}/.well-known/openid-configuration`, {
                headers: { 'x-target-url': identityOrigin }
            });
            const tokenEndpoint = discovery.data.token_endpoint;
            console.log('Token Endpoint:', tokenEndpoint);

            // Extract only the path part of the Token Endpoint URL
            const tokenPath = new URL(tokenEndpoint).pathname;
            const tokenOrigin = new URL(tokenEndpoint).origin;

            // Step 3: Request Access Token (also via proxy)
            console.log('Step 3: Requesting Access Token...');
            const proxiedToken = `/docuware-proxy${tokenPath}`;
            const params = new URLSearchParams();
            params.append('grant_type', 'password');
            params.append('username', username);
            params.append('password', password);
            params.append('client_id', 'docuware.platform.net.client');
            params.append('scope', 'docuware.platform'); // Reverted: Removed offline_access

            const tokenResponse = await axios.post(proxiedToken, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'x-target-url': tokenOrigin
                }
            });

            const { access_token } = tokenResponse.data;
            console.log('✅ Authentication successful!');

            // CACHE CREDENTIALS FOR AUTO-REFRESH
            cachedCredentials = {
                username,
                password,
                url,
                proxiedToken,
                tokenOrigin
            };

            // Save to SessionStorage
            const authData = {
                token: access_token,
                username: username,
                url: baseUrl,
                organizationId: orgId
            };
            sessionStorage.setItem(AUTH_KEY, JSON.stringify(authData));

            // Set default header for future requests
            api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;

            return authData;
        } catch (error) {
            console.error('❌ Login failed:', error);

            // Provide more specific error messages
            if (error.response) {
                const status = error.response.status;
                const data = error.response.data;

                if (status === 400) {
                    // Don't mask the error. It could be invalid_grant (bad password) OR invalid_request (bad proxy).
                    // DocuWare returns { "error": "invalid_grant", "error_description": "..." }
                    const errorMsg = data.error_description || data.error || 'Invalid credentials or bad request';
                    throw new Error(`Login Failed (400): ${errorMsg}`);
                } else if (status === 401) {
                    throw new Error('Unauthorized. Please verify your credentials.');
                } else if (status === 404) {
                    throw new Error('Service not found. Please check your Platform URL.');
                } else {
                    throw new Error(`Server error (${status}): ${data.error_description || data.error || 'Unknown error'}`);
                }
            } else if (error.request) {
                throw new Error('Cannot reach DocuWare server. Please check your URL and internet connection.');
            } else {
                throw new Error(error.message || 'An unexpected error occurred.');
            }
        }
    },

    // 2. Logout Function
    logout: () => {
        sessionStorage.removeItem(AUTH_KEY);
        delete api.defaults.headers.common['Authorization'];
        cachedCredentials = null;
        // Optional: Redirect to login page
        window.location.href = '/';
    },

    // 3. Get Current User (from storage)
    getCurrentUser: () => {
        const stored = sessionStorage.getItem(AUTH_KEY);
        if (stored) {
            const authData = JSON.parse(stored);
            // Restore header (baseURL stays as /DocuWare/Platform for proxy)
            api.defaults.headers.common['Authorization'] = `Bearer ${authData.token}`;
            return authData;
        }
        return null;
    },

    // 4. Refresh Access Token
    refreshAccessToken: async () => {
        try {
            const stored = sessionStorage.getItem(AUTH_KEY);
            if (!stored) throw new Error('No session to refresh');

            const authData = JSON.parse(stored);
            if (!authData.refreshToken || !authData.tokenEndpoint) throw new Error('No refresh token available');

            console.log('🔄 Attempting checking token refresh...');

            // Extract endpoint details
            const tokenPath = new URL(authData.tokenEndpoint).pathname;
            const tokenOrigin = new URL(authData.tokenEndpoint).origin;
            const proxiedToken = `/docuware-proxy${tokenPath}`;

            const params = new URLSearchParams();
            params.append('grant_type', 'refresh_token');
            params.append('refresh_token', authData.refreshToken);
            params.append('client_id', 'docuware.platform.net.client');

            const response = await axios.post(proxiedToken, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'x-target-url': tokenOrigin
                }
            });

            const { access_token, refresh_token } = response.data;

            // Update storage
            const newAuthData = {
                ...authData,
                token: access_token,
                refreshToken: refresh_token || authData.refreshToken // Keep old if not rotated
            };
            sessionStorage.setItem(AUTH_KEY, JSON.stringify(newAuthData));

            // Update global header
            api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;

            console.log('✅ Token refreshed successfully!');
            return access_token;

        } catch (error) {
            console.error('❌ Token refresh failed:', error);
            authService.logout(); // Force logout if refresh fails
            throw error;
        }
    }
};

// Inject authService into api to break circular dependency
injectAuthService(authService);
