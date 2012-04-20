#
# Copyright (c) 2012, Joyent, Inc. All rights reserved.
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

#
# Tools
#
NODEUNIT	:= ./node_modules/.bin/nodeunit

#
# Files
#
DOC_FILES	 = index.restdown
JS_FILES	:= $(shell ls *.js) $(shell find lib capi test -name '*.js')
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = $(JS_FILES)
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -f tools/jsstyle.conf
SHRINKWRAP	 = npm-shrinkwrap.json
SMF_MANIFESTS_IN = smf/manifests/ufds-master.xml.in

CLEAN_FILES	+= node_modules $(SHRINKWRAP) cscope.files

include ./tools/mk/Makefile.defs
include ./tools/mk/Makefile.node.defs
include ./tools/mk/Makefile.node_deps.defs
include ./tools/mk/Makefile.smf.defs

#
# Variables
#

# Mountain Gorilla-spec'd versioning.

ROOT                    := $(shell pwd)
RELEASE_TARBALL         := ufds-pkg-$(STAMP).tar.bz2
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
	$(NPM) install

$(NODEUNIT): | $(NPM_EXEC)
	$(NPM) install

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

.PHONY: test
test: add_test bind_test compare_test del_test mod_test search_test

.PHONY: pkg
pkg:

.PHONY: release
release: all docs
	@echo "Building $(RELEASE_TARBALL)"
	@mkdir -p $(TMPDIR)/root/opt/smartdc/ufds
	@mkdir -p $(TMPDIR)/site
	@touch $(TMPDIR)/site/.do-not-delete-me
	@mkdir -p $(TMPDIR)/root
	@mkdir -p $(TMPDIR)/root/opt/smartdc/ufds/ssl
	cp -r   $(ROOT)/build \
                $(ROOT)/capi \
                $(ROOT)/capi.js \
                $(ROOT)/data \
		$(ROOT)/lib \
		$(ROOT)/main.js \
		$(ROOT)/node_modules \
		$(ROOT)/package.json \
		$(ROOT)/schema \
		$(ROOT)/smf \
		$(TMPDIR)/root/opt/smartdc/ufds/
	(cd $(TMPDIR) && $(TAR) -jcf $(ROOT)/$(RELEASE_TARBALL) root site)
	@rm -rf $(TMPDIR)

.PHONY: publish
publish: release
	@if [[ -z "$(BITS_DIR)" ]]; then \
		echo "error: 'BITS_DIR' must be set for 'publish' target"; \
		exit 1; \
	fi
	mkdir -p $(BITS_DIR)/ufds
	cp $(ROOT)/$(RELEASE_TARBALL) $(BITS_DIR)/ufds/$(RELEASE_TARBALL)


include ./tools/mk/Makefile.deps
include ./tools/mk/Makefile.node.targ
include ./tools/mk/Makefile.node_deps.targ
include ./tools/mk/Makefile.smf.targ
include ./tools/mk/Makefile.targ
