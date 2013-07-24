#
# Copyright (c) 2013, Joyent, Inc. All rights reserved.
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
NODEUNIT	:= ./node_modules/.bin/nodeunit

#
# Files
#
DOC_FILES	 = index.restdown
JS_FILES	:= $(shell ls *.js) \
                   $(shell find lib capi schema test -name '*.js')
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = $(JS_FILES)
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -f tools/jsstyle.conf
SMF_MANIFESTS_IN	 = smf/manifests/ufds-master.xml.in \
			smf/manifests/ufds-capi.xml.in \
			smf/manifests/ufds-replicator.xml.in

CLEAN_FILES	+= node_modules cscope.files

# The prebuilt sdcnode version we want. See
# "tools/mk/Makefile.node_prebuilt.targ" for details.
ifeq ($(shell uname -s),SunOS)
	NODE_PREBUILT_VERSION=v0.8.23
	NODE_PREBUILT_TAG=zone
endif

include ./tools/mk/Makefile.defs
ifeq ($(shell uname -s),SunOS)
	include ./tools/mk/Makefile.node_prebuilt.defs
else
	include ./tools/mk/Makefile.node.defs
endif
include ./tools/mk/Makefile.smf.defs

#
# Variables
#

# Mountain Gorilla-spec'd versioning.

ROOT                    := $(shell pwd)
RELEASE_TARBALL         := $(NAME)-pkg-$(STAMP).tar.bz2
TMPDIR                  := /tmp/$(STAMP)

#
# Env vars
#
PATH	:= $(NODE_INSTALL)/bin:/opt/local/bin:${PATH}

#
# Repo-specific targets
#
.PHONY: all
all: $(SMF_MANIFESTS) | $(NODEUNIT) $(REPO_DEPS)
	$(NPM) install && $(NPM) update

$(NODEUNIT): | $(NPM_EXEC)
	$(NPM) install && $(NPM) update

.PHONY: add_test
add_test: $(NODEUNIT)
	$(NODEUNIT) test/add.test.js --reporter tap

.PHONY: bind_test
bind_test: $(NODEUNIT)
	$(NODEUNIT) test/bind.test.js --reporter tap

.PHONY: compare_test
compare_test: $(NODEUNIT)
	$(NODEUNIT) test/compare.test.js --reporter tap

.PHONY: del_test
del_test: $(NODEUNIT)
	$(NODEUNIT) test/del.test.js --reporter tap

.PHONY: mod_test
mod_test: $(NODEUNIT)
	$(NODEUNIT) test/mod.test.js --reporter tap

.PHONY: search_test
search_test: $(NODEUNIT)
	$(NODEUNIT) test/search.test.js --reporter tap

.PHONY: pwdpolicy_test
pwdpolicy_test: $(NODEUNIT)
	$(NODEUNIT) test/pwdpolicy.test.js --reporter tap

.PHONY: test
test: add_test bind_test compare_test del_test mod_test search_test pwdpolicy_test

.PHONY: pkg
pkg:

.PHONY: release
release: all docs
	@echo "Building $(RELEASE_TARBALL)"
	@mkdir -p $(TMPDIR)/root/opt/smartdc/ufds
	@mkdir -p $(TMPDIR)/site
	@touch $(TMPDIR)/site/.do-not-delete-me
	@mkdir -p $(TMPDIR)/root
	@mkdir -p $(TMPDIR)/root/opt/smartdc/ufds/etc
	@mkdir -p $(TMPDIR)/root/opt/smartdc/ufds/ssl
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
		$(ROOT)/npm-shrinkwrap.json \
		$(ROOT)/schema \
		$(ROOT)/sapi_manifests \
		$(ROOT)/smf \
		$(ROOT)/test \
		$(TMPDIR)/root/opt/smartdc/ufds/
	cp $(ROOT)/etc/config.json.in $(TMPDIR)/root/opt/smartdc/ufds/etc
	cp $(ROOT)/etc/replicator.json.in $(TMPDIR)/root/opt/smartdc/ufds/etc
	(cd $(TMPDIR) && $(TAR) -jcf $(ROOT)/$(RELEASE_TARBALL) root site)
	@rm -rf $(TMPDIR)

.PHONY: publish
publish: release
	@if [[ -z "$(BITS_DIR)" ]]; then \
		echo "error: 'BITS_DIR' must be set for 'publish' target"; \
		exit 1; \
	fi
	mkdir -p $(BITS_DIR)/ufds
	cp $(ROOT)/$(RELEASE_TARBALL) $(BITS_DIR)/$(NAME)/$(RELEASE_TARBALL)


include ./tools/mk/Makefile.deps
ifeq ($(shell uname -s),SunOS)
	include ./tools/mk/Makefile.node_prebuilt.targ
else
	include ./tools/mk/Makefile.node.targ
endif
include ./tools/mk/Makefile.smf.targ
include ./tools/mk/Makefile.targ
