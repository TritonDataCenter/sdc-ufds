#!/usr/bin/bash

set -o xtrace
set -o errexit

UFDS_RELEASE_TARBALL=$1
LFDS_RELEASE_TARBALL=$2
echo "Building ${UFDS_RELEASE_TARBALL}"
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

( cd ${tmpdir}/root/opt
    ${TAR} -jxf ${ROOT}/nodejs-0.4.12.tar.bz2 )

( cd ${tmpdir}; tar -jcf ${ROOT}/${UFDS_RELEASE_TARBALL} root site)

rm -rf ${tmpdir}

echo "Building ${LFDS_RELEASE_TARBALL}"
lfds_tmpdir="/tmp/lfds.$$"
mkdir -p ${lfds_tmpdir}/root
mkdir -p ${lfds_tmpdir}/site

(cd ${lfds_tmpdir}/root
    mkdir -p opt/smartdc/lfds
    cp -r ${ROOT}/cfg          \
          ${ROOT}/docs/pkg     \
          ${ROOT}/lib          \
          ${ROOT}/main.js      \
          ${ROOT}/node_modules \
          ${ROOT}/package.json \
          ${ROOT}/schema       \
            ${ROOT}/tools opt/smartdc/lfds/)

( cd ${lfds_tmpdir}/root/opt
    ${TAR} -jxf ${ROOT}/nodejs-0.4.12.tar.bz2 )

( cd ${lfds_tmpdir}; tar -jcf ${ROOT}/${LFDS_RELEASE_TARBALL} root site)

rm -rf ${lfds_tmpdir}