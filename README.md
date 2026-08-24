# @212/hub-contract

The wire contract between **212 Residential Services** (`lg-glitch/212rs`) and
the **212 Hub** (`lg-glitch/212_hub_new`).

Types and route constants only. No runtime dependencies, ever.

## Why

The two systems are separate repos, separate Vercel projects and separate
Firebase projects, and they talk over HTTP and nothing else. That separation is
right. What it lacked was any way for the two ends to disagree *loudly* — each
declared the request and response shapes independently, so renaming a field
broke the other side in production rather than at build time.

Now the shapes live here once and both repos import them.

## Installing

Both apps depend on it by git ref:

```
npm install github:lg-glitch/212-hub-contract#v1.0.0
```

Pinning the tag is deliberate — an unpinned `#main` means a change lands in
whichever app installs next, which is the opposite of what this is for.

## Changing it

1. **Add, do not rewrite.** One side always deploys before the other, so every
   change must be readable by both the old and the new code for at least one
   deploy. New fields are optional.
2. **Removing a field is two releases.** Stop writing it, ship both sides, then
   remove it here.
3. Bump the version, tag it, then bump the dependency in each app.
