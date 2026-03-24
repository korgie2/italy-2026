#!/bin/bash
cd /opt
git clone https://github.com/korgie2/italy-2026.git italy2026
cd italy2026
pm2 start server.js --name italy2026
pm2 save
echo "Done! App running at http://5.161.64.70:3000"
