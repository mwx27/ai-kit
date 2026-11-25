# Before init writes anything

`/honest-docs:init` first runs `install.mjs --preflight`, which writes nothing and prints
`{"empty":bool,"blocking":[...],"ignored":[{"file","source","pattern"}...]}`. Settle what it reports
in this order, before the docs folder question: a stop at the first spares the second.

## No code yet

Unless the skill's arguments are `now`, when `empty` is true ask with `AskUserQuestion`: "This
project has no code yet. Will you generate the app with a tool like create-next-app or
create-expo-app?"

- Generate the app first (Recommended): write nothing. Tell the user to generate the app, commit it,
  then run `/honest-docs:init` again. When `blocking` lists entries, name them: "the generator may
  refuse to run because of these files; move them out of the folder for a moment."
- Install now: for a project no generator starts (scripts, docs only, code written by hand). Go on.

Without `AskUserQuestion`, stop there, writing nothing, and give both ways: generate the app (naming
`blocking` as above) and run init again, or run `/honest-docs:init now` to install anyway.

## Ignored files

When `ignored` lists files, ask with `AskUserQuestion`, naming every distinct pattern with the file
and line from its `source`: "<file> line <n> ignores <pattern> (and …), so honest-docs would not get
into the repo."

- Fix .gitignore (Recommended): follow `gitignore.md`, then go on.
- Cancel: write nothing.

Without `AskUserQuestion`, stop there, writing nothing, as `gitignore.md` says.
