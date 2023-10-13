#!/bin/bash

if [ -z "$URL" ]
then
    echo "Error: URL env variable not set"
    echo "Usage: bash container_main.sh"
    echo "The URL env variable must be set to the server's URL."
    exit 1
fi

# Run the client, piping stdout to out.log.
npm start > out.log

# Post out.log to the server's "/log" endpoint (gzip compressed).
LOG_URL="${URL%/}/log"
gzip --stdout out.log | curl -v -i --data-binary @- -H "Content-Encoding: gzip" -H "Content-Type: text/plain" "$LOG_URL"