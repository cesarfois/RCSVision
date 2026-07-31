import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';


/**
 * @file proxy-server.js
 * @description Dynamic Proxy Server for DocuWare Integration.
 * Acts as a middleware to bypass CORS restrictions when consuming the DocuWare REST API
 * from a browser-based client. This server forwards requests to the target URL specified
 * in the 'x-target-url' header.
 * 
 * @author RCSVision Engineer
 * @version 2.0.0
 */

// Initialize Express App
const app = express();
const PORT = 3001;

// ----------------------------------------------------------------------------
// 1. Global Middleware Configuration
// ----------------------------------------------------------------------------

/**
 * Configure Cross-Origin Resource Sharing (CORS).
 * Allows the frontend (running on different ports like 5173) to communicate with this proxy.
 * 
 * @type {cors.CorsOptions}
 */
app.use(cors({
    origin: true, // Dynamically reflects the request origin (Postman, localhost:5173, etc.)
    credentials: true, // Allow cookies/auth headers
    allowedHeaders: ['Content-Type', 'Authorization', 'x-target-url'] // Explicitly allow our custom routing header
}));

/**
 * Pre-flight Request Handler (OPTIONS).
 * Browsers send an OPTIONS request before the actual POST/PUT/GET to check permissions.
 * We intercept this immediately to return 200 OK, preventing CORS blocking.
 */
app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// ----------------------------------------------------------------------------
// 2. Proxy Logic Implementation
// ----------------------------------------------------------------------------

/**
 * Configuration for the http-proxy-middleware.
 * Defines how requests are routed, transformed, and logged.
 * 
 * @type {import('http-proxy-middleware').Options}
 */
const proxyOptions = {
    /**
     * @function router
     * @description Dynamic Routing Logic.
     * Instead of a static target, we read the 'x-target-url' header from the incoming request.
     * This allows the frontend to talk to ANY DocuWare organization dynamically.
     * 
     * @param {express.Request} req - Incoming Express request object
     * @returns {string} The target URL to proxy to
     * @throws {Error} If x-target-url is missing
     */
    router: (req) => {
        // Extract target from custom header
        const targetUrl = req.headers['x-target-url'];
        const timestamp = new Date().toISOString();

        // Logging for audit and debugging
        console.log(`[${timestamp}] [Proxy] Incoming request: ${req.method} ${req.url}`);
        // console.log(`[${timestamp}] [Proxy] Headers:`, JSON.stringify(req.headers, null, 2)); // Valid verbose log

        if (!targetUrl) {
            console.error(`[${timestamp}] [Proxy] ❌ Missing X-Target-URL header on ${req.method} ${req.url}`);
            // Critical Error: Without a target, we cannot proxy.
            throw new Error('Missing X-Target-URL header');
        }

        console.log(`[${timestamp}] [Proxy] ✅ Routing to: ${targetUrl}`);
        return targetUrl;
    },

    changeOrigin: true, // Changes the 'Host' header to match the target, required for name-based vhosting
    secure: false, // Disables SSL verification (self-signed certs support)

    /**
     * @function onProxyReq
     * @description Request Interceptor.
     * Cleans up the request before sending it to the final destination.
     */
    onProxyReq: (proxyReq, req, res) => {
        const target = req.headers['x-target-url'];
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [Proxy] 📤 Forwarding ${req.method} ${req.originalUrl} -> ${target}`);

        // DEBUG: detailed upstream construction
        try {
            // Remove /DocuWare/Platform prefix if present in originalUrl because target often is the root
            // BUT wait, changeOrigin handles host, but path is just appended.
            // If target is https://example.com and req.url is /DocuWare/Platform/Foo
            // Result is https://example.com/DocuWare/Platform/Foo
            const upstream = target.replace(/\/$/, '') + req.originalUrl;
            console.log(`[${timestamp}] [Proxy] 🔗 FULL UPSTREAM URL (Calculated): ${upstream}`);
        } catch (e) { console.error('Error logging upstream', e); }

        // Cleanliness: Remove the internal routing header so DocuWare doesn't see it
        proxyReq.removeHeader('x-target-url');
        proxyReq.removeHeader('origin'); // Let changeOrigin handle the origin header re-writing
    },

    /**
     * @function onProxyRes
     * @description Response Interceptor.
     * Logs the status code received from the upstream server.
     */
    onProxyRes: (proxyRes, req, res) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [Proxy] 📥 Response ${proxyRes.statusCode} for ${req.method} ${req.url}`);
    },

    /**
     * @function onError
     * @description Global Error Handler for the Proxy.
     * Catches network errors (e.g., DNS failure, Connection Refused) and sends a JSON response.
     */
    onError: (err, req, res) => {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] [Proxy] ❌ Error:`, err.message);
        res.status(500).json({ error: 'Proxy Error', details: err.message });
    }
};

// ----------------------------------------------------------------------------
// 3. Route Configurations
// ----------------------------------------------------------------------------

/**
 * Route: /DocuWare/*
 * Main entry point for DocuWare Platform API calls.
 * Uses pathRewrite to ensure the /DocuWare prefix is preserved if needed,
 * though strict routing usually handles this.
 */
app.use('/DocuWare', createProxyMiddleware({
    ...proxyOptions,
    pathRewrite: {
        '^/': '/DocuWare/' // Ensures standard DocuWare behavior if striped
    }
}));

/**
 * Route: /docuware-proxy/*
 * Alternate entry point, often used for Identity Service or special auth flows.
 * Uses the exact same proxy options.
 */
app.use('/docuware-proxy', createProxyMiddleware(proxyOptions));

// Serve static assets in production (from dist folder)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, 'dist')));

// SPA router fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ----------------------------------------------------------------------------
// 4. Server Start (Conditional)
// ----------------------------------------------------------------------------

// Only start the server if running directly (e.g., node proxy-server.js)
// If imported by Netlify Functions, we just export the app.
if (process.argv[1] && (process.argv[1].endsWith('proxy-server.js') || process.argv[1] === fileURLToPath(import.meta.url))) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`===============================================`);
        console.log(`   Dynamic Proxy Server Running`);
        console.log(`   Port: ${PORT}`);
        console.log(`   Mode: Development / Audit`);
        console.log(`===============================================`);
    });
}

// Export app for Serverless usage (Netlify)
export default app;
