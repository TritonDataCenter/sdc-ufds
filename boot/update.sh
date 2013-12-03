#!/usr/bin/bash
#
# Copyright (c) 2013 Joyent Inc., All rights reserved.
#
# You may want to run this right before we attempt the whole thing upgrade:
#
#   psql -U postgres \
#   --command='CREATE DATABASE moray_backup WITH TEMPLATE moray OWNER moray;'
#
# It should be painless to rollback by just renaming stuff:
#
#   psql -U postgres \
#   --command='ALTER DATABASE moray RENAME TO moray_upgrade_failure'
#   psql -U postgres \
#   --command='ALTER DATABASE moray_backup RENAME TO moray'
#
export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
set -o xtrace

role=ufds
PATH=/opt/smartdc/ufds/build/node/bin:/opt/smartdc/ufds/node_modules/.bin:/opt/local/bin:/opt/local/sbin:/usr/bin:/usr/sbin

METADATA=/var/tmp/metadata.json

MORAY_HOST=$(json -f ${METADATA} MORAY_SERVICE)
MORAY_PORT=2222
BUCKET=$(getbucket -h ${MORAY_HOST} -p ${MORAY_PORT} ufds_o_smartdc)

if [[ $? -ne 0 ]]; then
  echo "Bucket ufds_o_smartdc does not exist. Assuming this is not an upgrade."
  exit 0
else
  VERSION=$(echo ${BUCKET} | json options.version)
  if [ "$VERSION" -le "6" ]; then
    echo "Version is smaller than or equal than six. Have to upgrade ufds_o_smartdc bucket."
    while read SQL
    do
      echo "Running SQL command using moray sql binary:"
      echo "$SQL"
      CMD=$(sql -h ${MORAY_HOST} -p ${MORAY_PORT} "${SQL}")
    done < /opt/smartdc/ufds/data/capi-305.sql
  else
    echo "Already updated to a version greater than 6, skipping capi-305 schema upgrade."
  fi
  exit 0
fi
