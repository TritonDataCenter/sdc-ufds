# UFDS Replicator

Repository: <git@git.joyent.com:ufds-replicator.git>
Browsing: <https://mo.joyent.com/ufds-replicator>
Who: Andres Rodriguez
Docs: <https://mo.joyent.com/docs/ufds-replicator>
Tickets/bugs: <https://devhub.joyent.com/jira/browse/CAPI>


# Overview

This repo serves two purposes: (1) It defines the guidelines and best
practices for Joyent engineering work (this is the primary goal), and (2) it
also provides boilerplate for an SDC project repo, giving you a starting
point for many of the suggestion practices defined in the guidelines. This is
especially true for node.js-based REST API projects.

Start with the guidelines: <https://mo.joyent.com/docs/eng>


# Development

To run the boilerplate API server:

    git clone git@git.joyent.com:eng.git
    cd eng
    git submodule update --init
    make all
    node server.js

To update the guidelines, edit "docs/index.restdown" and run `make docs`
to update "docs/index.html".

Before commiting/pushing run `make prepush` and, if possible, get a code
review.



# Testing

    make test

If you project has setup steps necessary for testing, then describe those
here.


# Starting a Repo Based on eng.git

Create a new repo called "some-cool-fish" in your "~/work" dir based on "eng.git":
Note: run this inside the eng dir.

    ./tools/mkrepo $HOME/work/some-cool-fish


# Your Other Sections Here

Add other sections to your README as necessary. E.g. Running a demo, adding
development data.



