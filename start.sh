#!/bin/bash
# TriliumNext Notes v0.103.0 startup script
cd /vol1/1000/HD1/APP/trilium/apps/server
TRILIUM_ENV=production \
TRILIUM_DATA_DIR=/vol1/1000/HD1/APP/trilium-data \
TRILIUM_PORT=8083 \
node dist/main.cjs
