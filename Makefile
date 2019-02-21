#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2019, Joyent, Inc.
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
# Tools
#
ISTANBUL	:= ./node_modules/.bin/istanbul

#
# Files
#
DOC_FILES	 = index.md ufds-replicator.md
JS_FILES	:= $(shell ls *.js) \
                   $(shell find lib capi schema test -name '*.js')
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = $(JS_FILES)
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

NODE_PREBUILT_VERSION=v0.10.48
# sdc-minimal-multiarch-lts 15.4.1
NODE_PREBUILT_IMAGE=18b094b0-eb01-11e5-80c1-175dac7ddf02
# The prebuilt sdcnode version we want. See
# "tools/mk/Makefile.node_prebuilt.targ" for details.
ifeq ($(shell uname -s),SunOS)
	NODE_PREBUILT_TAG=zone
endif

ENGBLD_USE_BUILDIMAGE	= true
ENGBLD_REQUIRE		:= $(shell git submodule update --init deps/eng)
include ./deps/eng/tools/mk/Makefile.defs
TOP ?= $(error Unable to access eng.git submodule Makefiles.)

ifeq ($(shell uname -s),SunOS)
	include ./deps/eng/tools/mk/Makefile.node_prebuilt.defs
	include ./deps/eng/tools/mk/Makefile.agent_prebuilt.defs
else
	include ./deps/eng/tools/mk/Makefile.node.defs
endif
include ./deps/eng/tools/mk/Makefile.smf.defs

#
# Variables
#

# Mountain Gorilla-spec'd versioning.

ROOT                    := $(shell pwd)
RELEASE_TARBALL         := $(NAME)-pkg-$(STAMP).tar.gz
RELSTAGEDIR                  := /tmp/$(NAME)-$(STAMP)

BASE_IMAGE_UUID = 04a48d7d-6bb5-4e83-8c3b-e60a99e0f48f
BUILDIMAGE_NAME = $(NAME)
BUILDIMAGE_DESC	= SDC UFDS
BUILDIMAGE_PKGSRC = postgresql91-client-9.1.24
AGENTS		= amon config registrar

#
# Env vars
#
PATH	:= $(NODE_INSTALL)/bin:/opt/local/bin:${PATH}

#
# Repo-specific targets
#
.PHONY: all
all: haproxy $(SMF_MANIFESTS) | $(ISTANBUL) $(REPO_DEPS) sdc-scripts
	$(NPM) install

$(ISTANBUL): | $(NPM_EXEC)
	$(NPM) install

# Build HAProxy when in SunOS
.PHONY: haproxy
ifeq ($(shell uname -s),SunOS)
haproxy:
	@echo "Building HAproxy"
	cd deps/haproxy && /opt/local/bin/gmake TARGET=solaris
else
haproxy:
	@echo "HAproxy building only in SunOS"
endif


CLEAN_FILES += deps/haproxy/haproxy

.PHONY: test
test: $(ISTANBUL)
	# CAPI-461: disable istanbul
	#$(ISTANBUL) cover --print none test/test.js
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
		$(ROOT)/deps/haproxy \
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
else
	include ./deps/eng/tools/mk/Makefile.node.targ
endif
include ./deps/eng/tools/mk/Makefile.smf.targ
include ./deps/eng/tools/mk/Makefile.targ

sdc-scripts: deps/sdc-scripts/.git
