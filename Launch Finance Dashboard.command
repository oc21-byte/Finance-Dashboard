#!/bin/zsh
cd /Users/oliverchau/Desktop/finance-dashboard
npm run dev &
sleep 4 && open http://localhost:5173
wait
