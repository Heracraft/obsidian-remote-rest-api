# Status

One line for each claim, progress report or stop. The newest line is at the
bottom. Format:

`YYYY-MM-DD | <task> | <who: session, worktree, branch> | claimed|progress|done|blocked | <note>`

A line has at most 600 characters. Put details in the commit message and
point to it. An agent adds a claim line before it starts, and a stop line
with what is done and what is not. Git merges this file with the union
driver, so lines from parallel branches do not conflict.
