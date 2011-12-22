#!/usr/bin/bash

set -o xtrace
set -o errexit

RELEASE_TARBALL=$1
echo "Building ${RELEASE_TARBALL}"

ROOT=$(pwd)

tmpdir="/tmp/ufds.$$"
mkdir -p ${tmpdir}/root
mkdir -p ${tmpdir}/site

(cd ${tmpdir}/root
    mkdir -p opt/smartdc/ufds
    cp -r ${ROOT}/capi         \
          ${ROOT}/capi.js      \
          ${ROOT}/cfg          \
          ${ROOT}/docs/pkg     \
          ${ROOT}/lib          \
          ${ROOT}/main.js      \
          ${ROOT}/node_modules \
          ${ROOT}/package.json \
          ${ROOT}/schema       \
            ${ROOT}/tools opt/smartdc/ufds/)

( cd ${tmpdir}/root
    ${TAR} -jxf ${ROOT}/nodejs-0.4.12.tar.bz2 )

( cd ${tmpdir}; tar -jcf ${RELEASE_TARBALL} root site)

rm -rf ${tmpdir}
