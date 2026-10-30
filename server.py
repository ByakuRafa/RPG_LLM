# HOW TO RUN ON WINDOWS:
# python server.py

import http.server
import socketserver

PORT = 8000
Handler = http.server.SimpleHTTPRequestHandler

# Força o mapeamento correto do arquivo .js para sistemas Windows
Handler.extensions_map.update({
    '.js': 'application/javascript',
})

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Servidor rodando em http://localhost:{PORT}")
    httpd.serve_forever()
