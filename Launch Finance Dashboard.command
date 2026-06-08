#!/bin/zsh
cd "$(dirname "$0")"
npm run dev &
sleep 4 && open http://localhost:5173
wait
