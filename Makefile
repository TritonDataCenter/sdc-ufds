#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright 2021 Joyent, Inc.
# Copyright 2023 MNX Cloud, Inc.
# Copyright 2025 Edgecast Cloud LLC.
#

#
# Makefile: basic Makefile for template API service
#
# This Makefile is a template for new repos. It contains only repo-specific
# logic and uses included makefiles to supply common targets (javascriptlint,
# jsstyle, restdown, etc.), which are used by other repos as well. You may well
# need to rewrite most of this file, but you shouldn't need to touch the
# included makefiles.
#
# If you find yourself adding support for new targets that could be useful for
# other projects too, you should add these to the original versions of the
# included Makefiles (in eng.git) so that other teams can use them too.
#
NAME		:= ufds

#
# Files
#
DOC_FILES	 = index.md ufds-replicator.md
JS_FILES	:= $(shell ls *.js) \
                   $(shell find lib capi schema test -name '*.js')
ESLINT_FILES     = $(JS_FILES)
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -f tools/jsstyle.conf
SMF_MANIFESTS_IN	 = smf/manifests/ufds-master.xml.in \
			smf/manifests/ufds-capi.xml.in \
			smf/manifests/ufds-capi-8081.xml.in \
			smf/manifests/ufds-capi-8082.xml.in \
			smf/manifests/ufds-capi-8083.xml.in \
			smf/manifests/ufds-capi-8084.xml.in \
			smf/manifests/ufds-replicator.xml.in

CLEAN_FILES	+= node_modules cscope.files coverage

ifeq ($(shell uname -s),SunOS)
	NODE_PREBUILT_VERSION=v6.17.1
	# minimal-64-lts@21.4.0
	NODE_PREBUILT_IMAGE=a7199134-7e94-11ec-be67-db6f482136c2
	NODE_PREBUILT_TAG := zone64
else
	NPM=npm
	NODE=node
	NPM_EXEC=$(shell which npm)
	NODE_EXEC=$(shell which node)
endif

ENGBLD_USE_BUILDIMAGE	= true
ENGBLD_REQUIRE		:= $(shell git submodule update --init deps/eng)
include ./deps/eng/tools/mk/Makefile.defs
TOP ?= $(error Unable to access eng.git submodule Makefiles.)

BUILD_PLATFORM  = 20210826T002459Z

ifeq ($(shell uname -s),SunOS)
	include ./deps/eng/tools/mk/Makefile.node_prebuilt.defs
	include ./deps/eng/tools/mk/Makefile.agent_prebuilt.defs
endif
include ./deps/eng/tools/mk/Makefile.smf.defs

#
# Variables
#

# Mountain Gorilla-spec'd versioning.

ROOT                    := $(shell pwd)
RELEASE_TARBALL         := $(NAME)-pkg-$(STAMP).tar.gz
RELSTAGEDIR                  := /tmp/$(NAME)-$(STAMP)

# triton-origin-x86_64-21.4.0
BASE_IMAGE_UUID = 502eeef2-8267-489f-b19c-a206906f57ef
BUILDIMAGE_NAME = $(NAME)
BUILDIMAGE_DESC	= SDC UFDS
BUILDIMAGE_DO_PKGSRC_UPGRADE = true
BUILDIMAGE_PKGSRC = coreutils haproxy postgresql96-client-9.6.24nb1
AGENTS		= amon config registrar

#
# Env vars
#
PATH	:= $(NODE_INSTALL)/bin:/opt/local/bin:${PATH}

#
# Repo-specific targets
#
.PHONY: all
all:  $(SMF_MANIFESTS) | $(NPM_EXEC) $(REPO_DEPS) sdc-scripts
	$(NPM) install

.PHONY: test
test:
	node test/test.js

.PHONY: pkg
pkg:

.PHONY: release
release: all docs
	@echo "Building $(RELEASE_TARBALL)"
	@mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/ufds
	@mkdir -p $(RELSTAGEDIR)/site
	@touch $(RELSTAGEDIR)/site/.do-not-delete-me
	@mkdir -p $(RELSTAGEDIR)/root
	@mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/ufds/etc
	@mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/ufds/ssl
	cp -r   $(ROOT)/build \
		$(ROOT)/capi \
		$(ROOT)/capi.js \
		$(ROOT)/replicator.js \
		$(ROOT)/data \
		$(ROOT)/bin \
		$(ROOT)/lib \
		$(ROOT)/main.js \
		$(ROOT)/node_modules \
		$(ROOT)/package.json \
		$(ROOT)/schema \
		$(ROOT)/sapi_manifests \
		$(ROOT)/smf \
		$(ROOT)/test \
		$(RELSTAGEDIR)/root/opt/smartdc/ufds/
	@mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/boot
	cp -R $(ROOT)/deps/sdc-scripts/* $(RELSTAGEDIR)/root/opt/smartdc/boot/
	cp -R $(ROOT)/boot/* $(RELSTAGEDIR)/root/opt/smartdc/boot/
	cp $(ROOT)/etc/haproxy.cfg.in $(RELSTAGEDIR)/root/opt/smartdc/ufds/etc
	(cd $(RELSTAGEDIR) && $(TAR) -I pigz -cf $(ROOT)/$(RELEASE_TARBALL) root site)
	@rm -rf $(RELSTAGEDIR)


.PHONY: publish
publish: release
	mkdir -p $(ENGBLD_BITS_DIR)/ufds
	cp $(ROOT)/$(RELEASE_TARBALL) $(ENGBLD_BITS_DIR)/$(NAME)/$(RELEASE_TARBALL)


include ./deps/eng/tools/mk/Makefile.deps
ifeq ($(shell uname -s),SunOS)
	include ./deps/eng/tools/mk/Makefile.node_prebuilt.targ
	include ./deps/eng/tools/mk/Makefile.agent_prebuilt.targ
endif
include ./deps/eng/tools/mk/Makefile.smf.targ
include ./deps/eng/tools/mk/Makefile.targ

sdc-scripts: deps/sdc-scripts/.git
