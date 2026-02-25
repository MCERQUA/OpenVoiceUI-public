#!/bin/bash
# Pi-Guy Job Runner
# This script is called by cron every minute to execute pending jobs.
#
# To install:
#   chmod +x /home/mike/Mike-AI/ai-eyes/job_runner.sh
#   crontab -e
#   Add: * * * * * /home/mike/Mike-AI/ai-eyes/job_runner.sh >> /home/mike/Mike-AI/ai-eyes/job_runner.log 2>&1

# Configuration
SERVER_URL="http://localhost:5000"
LOG_FILE="/home/mike/Mike-AI/ai-eyes/job_runner.log"

# Timestamp
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Running job check..."

# Call the run-pending endpoint
RESULT=$(curl -s -X POST "${SERVER_URL}/api/jobs/run-pending" -H "Content-Type: application/json")

# Log result
if [ $? -eq 0 ]; then
    RAN=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ran', 0))" 2>/dev/null)
    if [ "$RAN" != "0" ] && [ -n "$RAN" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Ran $RAN job(s): $RESULT"
    fi
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Failed to contact server"
fi
