#!/bin/bash

# directory stuff

# Note: you must run this command in the folder
# "collabs-nsdi/client", i.e., where the script lives.
REPO_DIR=".."

CLIENT_DIR="$REPO_DIR/client"
CLIENT_CMD=( 'npm' 'start' )

SERVER_DIR="$REPO_DIR/server"
SERVER_CMD=( 'npm' 'start' )

start_server() {
    # Returns PID of server so it can be stopped later.
    pushd "$SERVER_DIR" >/dev/null
    "${SERVER_CMD[@]}" "$LOG_FOLDER" "$SCENARIO" "$NUM_USERS" "$FRAMEWORK" "$TRIAL" lx &
    SERVER_PID=$!
    popd >/dev/null
}

start_one_client() {
    # Returns PID of client so it can be stopped later.
    pushd "$CLIENT_DIR" >/dev/null
    URL="http://localhost:8080/" "${CLIENT_CMD[@]}" &> "$TRIAL_DIR/client$(($i - 1)).log" &
    CLIENT_PID=$!
    popd >/dev/null
}

run_experiment() {
    LOG_FOLDER="$1"
    SCENARIO="$2"
    NUM_USERS="$3"
    FRAMEWORK="$4"
    TRIAL="$5"

    NUM_USERS_PADDED=$(printf "%03d" $NUM_USERS)
    TRIAL_DIR="$LOG_FOLDER/$SCENARIO-$NUM_USERS_PADDED-$FRAMEWORK/$TRIAL"
    mkdir -p $TRIAL_DIR
    TRIAL_DIR=$(realpath "$TRIAL_DIR")
    LOG_FOLDER=$(realpath "$LOG_FOLDER")

    # start the server
    #echo "starting server" >&2
    start_server
    #echo "finished starting server" >&2

    # wait a bit for server to start up
    sleep 4

    # start the clients
    #declare -a CLIENT_PID_LIST
    CLIENT_PID_LIST=()
    for i in $(seq $NUM_USERS); do
        #echo "starting client" >&2
        start_one_client
        CLIENT_PID_LIST+=( "$CLIENT_PID" )
        #echo "finished starting client" >&2
    done

    #ps -jf

    # Run until server exits.
    wait $SERVER_PID

    # Kill clients, in case they didn't get the message to exit.
    for i in "${CLIENT_PID_LIST[@]}"; do
        PGID=$(ps -o pgid= $i | grep -o [0-9]*)
        [ ! -z "$PGID" ] && kill -TERM -- "-$PGID"
    done

    exit 0
}

LOG_FOLDER="$1"
SCENARIO="$2"
NUM_USERS="$3"
FRAMEWORK="$4"
TRIAL="$5"

[ ! -z "$LOG_FOLDER" ] && [ ! -z "$SCENARIO" ] && [ ! -z "$NUM_USERS" ] && [ ! -z "$FRAMEWORK" ] && [ ! -z "$TRIAL" ] && run_experiment $LOG_FOLDER $SCENARIO $NUM_USERS $FRAMEWORK $TRIAL || echo "Usage: bash local_exp.sh <logFolder> <scenario> <numUsers> <framework> <trial>    See the server's usage for more info."
