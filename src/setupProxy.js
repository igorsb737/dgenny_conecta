const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  console.log('🔧 Configurando proxy para EspoCRM...');
  
  app.use(
    '/api/crm',
    createProxyMiddleware({
      target: 'https://crm.appvendai.com.br',
      changeOrigin: true,
      secure: true,
      pathRewrite: {
        '^/api/crm': '/api/v1'
      },
      onProxyReq: (proxyReq, req, res) => {
        console.log('📤 Proxy request:', req.method, req.url);
        // Adiciona o header de autorização
        const apiKey = process.env.REACT_APP_ESPO_API_KEY;
        if (apiKey) {
          proxyReq.setHeader('X-Api-Key', apiKey);
          console.log('🔑 API Key adicionada ao header');
        }
        proxyReq.setHeader('Content-Type', 'application/json');
      },
      onProxyRes: (proxyRes, req, res) => {
        console.log('📥 Proxy response:', proxyRes.statusCode, req.url);
      },
      onError: (err, req, res) => {
        console.error('❌ Proxy error:', err.message);
      },
      logLevel: 'debug'
    })
  );
  
  console.log('✅ Proxy configurado para /api/crm -> https://crm.appvendai.com.br/api/v1');
};
