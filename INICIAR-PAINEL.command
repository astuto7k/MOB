#!/bin/zsh
cd "${0:A:h}/arquivos-completos/outputs/android-remote-hub-evolucao"
node node_modules/.bin/pglite-server --db="${0:A:h}/arquivos-completos/work/qa-runtime-db" --port=54329 --host=127.0.0.1 --max-connections=8 &
node "${0:A:h}/arquivos-completos/work/start-local-panel.mjs" api &
node "${0:A:h}/arquivos-completos/work/start-local-panel.mjs" web &
wait
