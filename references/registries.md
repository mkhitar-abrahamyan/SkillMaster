# Registries Reference

How to read what a registry says about a package without installing it. Shared by
`ai-code-verifier`, which checks that what a change pulls in exists and is the intended thing, and
`release-captain`, which checks that a published version arrived.

Query metadata only. Installing, downloading, or running a package to look at it runs its
install-time code, which is what a near-miss name is waiting for.

## Per ecosystem

For each: where its versions and their dates are, where its source and publisher are, and what
can run when it is installed or built.

- **npm.** `npm view <pkg> versions time dist-tags --json`; `npm view <pkg> repository.url
  maintainers`. Install-time code: `npm view <pkg>@<version> scripts` (`preinstall`, `install`,
  `postinstall`), or a `binding.gyp`, which builds native code. Provenance:
  `npm view <pkg>@<version> dist.attestations`, and `npm audit signatures` for what is installed.
- **PyPI.** `https://pypi.org/pypi/<project>/json`: `releases` lists each version's files with
  `upload_time_iso_8601` and `packagetype`; `info.project_urls` names the source. A version with
  only an sdist runs its build backend at install; a wheel runs nothing then, but a `.pth` file
  in it runs at every interpreter start.
- **Go.** `https://proxy.golang.org/<module>/@v/list`, and `.../@v/<version>.info` for its
  `Time`; `go list -m -versions <module>` does the same. The module path is the source. Nothing
  runs at download; cgo builds C code, and `go generate` runs only when invoked.
- **crates.io.** `https://crates.io/api/v1/crates/<name>`: `versions[]` with `num`,
  `created_at`, and `yanked`; `crate.repository`. A `build.rs` and procedural macros run at build.
- **RubyGems.** `https://rubygems.org/api/v1/versions/<name>.json` for versions and dates;
  `https://rubygems.org/api/v1/gems/<name>.json` for `source_code_uri`. Native extensions build,
  and run their `extconf.rb`, at install.
- **Packagist.** `https://repo.packagist.org/p2/<vendor>/<package>.json`: each version's `time`
  and `source`. A dependency's scripts do not run; a `composer-plugin` does, once `allow-plugins`
  lets it.
- **NuGet.** `https://api.nuget.org/v3-flatcontainer/<id>/index.json`, with the id in lower case,
  for versions; the package's page on nuget.org for owners, dates, and the project URL. The
  `.props` and `.targets` in its `build/` and `buildTransitive/` folders run in every build.
- **Maven Central.** `https://repo1.maven.org/maven2/<group/as/path>/<artifact>/maven-metadata.xml`
  for versions; the POM's `<scm>` for the source. A dependency runs nothing at resolution; plugins
  and annotation processors run in the build.
- **Container images.** `docker buildx imagetools inspect <image>:<tag>` shows the digest and the
  platforms; `skopeo inspect docker://<image>:<tag>` the creation date and labels, where
  `org.opencontainers.image.source` names the source.
- **GitHub Actions.** `git ls-remote --tags https://github.com/<owner>/<repo>` lists the action's
  tags and the commits they point at. An action runs with the workflow's token and secrets.

## Signs of a near-miss name

Any one of these is a finding to report, not a reason to install the package and look:

- One edit from a popular name, a swapped separator (`-`, `_`, `.`), a missing or different scope
  (`@scope/pkg` and `pkg`), or a plausible name nobody published until recently.
- First published days or weeks ago, few versions, few downloads (npm:
  `https://api.npmjs.org/downloads/point/last-week/<pkg>`; PyPI:
  `https://pypistats.org/api/packages/<project>/recent`).
- No source repository, one that does not contain the package, or a publisher unrelated to the
  project the package claims to be.
- Install-time code in a package that has no reason to have any.

## Pinned to what was checked

- An action pinned to a commit SHA: the SHA is one that a tag or branch of the action's own
  repository points at. A commit that only a fork contains is still served from the parent
  repository's URL, and it is not the action.
- An image pinned to a digest: `docker buildx imagetools inspect <image>@<digest>` resolves it.
- A lockfile entry: its resolved URL is the registry's, and its integrity hash matches the one the
  registry lists, such as `npm view <pkg>@<version> dist.integrity`.

## After a publish

Check that each package lists the new version, on the channel it was meant for, such as an npm
dist-tag or a PyPI pre-release. A registry does not accept the same version twice, so when a
version is late, check again on a schedule instead of publishing again.

| Registry | Lists the version | Usual delay |
|----------|-------------------|-------------|
| npm | `npm view <pkg>@<version> version`; `npm view <pkg> dist-tags` | minutes; a new version has stayed missing for over 45 minutes |
| PyPI | `https://pypi.org/pypi/<project>/<version>/json` | minutes |
| crates.io | the crate's API above | minutes |
| Maven Central | `maven-metadata.xml` above | up to a few hours for search |
| NuGet | the flat container above | indexing can take up to an hour |
| Container images | `docker buildx imagetools inspect <image>:<tag>` | as soon as the push completes |
| GitHub Releases | `gh release view <tag>` | at once |
