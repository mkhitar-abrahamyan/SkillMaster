#!/usr/bin/env python3
"""Validate every skill in skills/ against the Agent Skills spec and SkillMaster packaging rules,
plus the Claude Code plugin manifests in .claude-plugin/.

Usage: python tools/validate_skills.py [--fix]
  --fix  re-copy canonical files from references/ over drifted per-skill copies.

Requires PyYAML and, for JavaScript syntax checks, Node.js on PATH.
"""
import filecmp
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / "skills"
SHARED_REFS = ROOT / "references"
EVALS = ROOT / "evals"

ALLOWED_KEYS = {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
FRONTMATTER_RE = re.compile(r"^---\r?\n(.*?)\r?\n---\r?\n", re.DOTALL)
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
# Bundled-resource paths mentioned in prose, e.g. `scripts/tool.js`, must ship with the skill.
BUNDLED_PATH_RE = re.compile(r"`((?:scripts|references|assets)/[\w.\-/]*[\w])`")
MAX_SKILL_LINES = 500
MIN_EVALS_PER_SIDE = 3


def check_frontmatter(skill_dir, text, errors):
    match = FRONTMATTER_RE.match(text)
    if not match:
        errors.append("SKILL.md must start with YAML frontmatter delimited by '---' lines")
        return
    try:
        meta = yaml.safe_load(match.group(1))
    except yaml.YAMLError as exc:
        errors.append(f"frontmatter is not valid YAML: {exc}")
        return
    if not isinstance(meta, dict):
        errors.append("frontmatter must be a YAML mapping")
        return

    unknown = set(meta) - ALLOWED_KEYS
    if unknown:
        errors.append(f"unknown frontmatter keys: {', '.join(sorted(unknown))}")

    name = meta.get("name")
    if not isinstance(name, str) or not 1 <= len(name) <= 64 or not NAME_RE.match(name):
        errors.append("name must be 1-64 chars of lowercase letters, digits and single hyphens")
    elif name != skill_dir.name:
        errors.append(f"name '{name}' must match directory name '{skill_dir.name}'")

    description = meta.get("description")
    if not isinstance(description, str) or not description.strip():
        errors.append("description is required")
    elif len(description) > 1024:
        errors.append(f"description is {len(description)} chars; max is 1024")
    elif "<" in description or ">" in description:
        errors.append("description must not contain angle brackets")

    compatibility = meta.get("compatibility")
    if compatibility is not None and (not isinstance(compatibility, str) or not 1 <= len(compatibility) <= 500):
        errors.append("compatibility must be a 1-500 char string")
    for key in ("license", "allowed-tools"):
        if key in meta and not isinstance(meta[key], str):
            errors.append(f"{key} must be a string")
    metadata = meta.get("metadata")
    if metadata is not None and not (
        isinstance(metadata, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in metadata.items())
    ):
        errors.append("metadata must map string keys to string values")


def check_references(skill_dir, errors):
    """Every relative link and bundled path must resolve inside the skill, which is all an install copies."""
    for md in skill_dir.rglob("*.md"):
        text = md.read_text(encoding="utf-8")
        targets = [(md.parent, t) for t in LINK_RE.findall(text)]
        if md.name == "SKILL.md":
            targets += [(skill_dir, t) for t in BUNDLED_PATH_RE.findall(text)]
        for base, target in targets:
            if re.match(r"^[a-z][a-z0-9+.-]*:", target) or target.startswith("#"):
                continue
            resolved = (base / target.split("#", 1)[0]).resolve()
            rel = md.relative_to(skill_dir)
            if not resolved.is_relative_to(skill_dir.resolve()):
                errors.append(f"{rel}: '{target}' points outside the skill; installs copy only the skill folder")
            elif not resolved.exists():
                errors.append(f"{rel}: '{target}' does not exist")


def check_shared_copies(skill_dir, fix, errors):
    refs = skill_dir / "references"
    if not refs.is_dir():
        return
    for copy in refs.iterdir():
        canonical = SHARED_REFS / copy.name
        if canonical.is_file() and not filecmp.cmp(canonical, copy, shallow=False):
            if fix:
                shutil.copyfile(canonical, copy)
                print(f"fixed: {copy.relative_to(ROOT)}")
            else:
                errors.append(f"references/{copy.name} differs from canonical references/{copy.name} (run with --fix)")


def check_scripts(skill_dir, errors):
    for script in skill_dir.rglob("*.js"):
        try:
            result = subprocess.run(["node", "--check", str(script)], capture_output=True, text=True)
        except FileNotFoundError:
            errors.append("node is required to syntax-check JavaScript")
            return
        if result.returncode != 0:
            # Node ends stderr with a version banner; report the error line itself.
            lines = result.stderr.strip().splitlines()
            message = next((line for line in lines if "Error" in line), lines[-1] if lines else "syntax check failed")
            errors.append(f"{script.relative_to(skill_dir)}: {message}")


def check_evals(skill_dir, errors):
    """Trigger evals use the skill-creator run_eval.py format: [{"query": str, "should_trigger": bool}]."""
    path = EVALS / f"{skill_dir.name}.json"
    if not path.is_file():
        errors.append(f"missing trigger evals: evals/{path.name}")
        return
    try:
        cases = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        errors.append(f"evals/{path.name} is not valid JSON: {exc}")
        return
    if not isinstance(cases, list) or not all(
        isinstance(c, dict) and isinstance(c.get("query"), str) and isinstance(c.get("should_trigger"), bool)
        for c in cases
    ):
        errors.append(f"evals/{path.name} must be a list of {{query: str, should_trigger: bool}}")
        return
    positives = sum(c["should_trigger"] for c in cases)
    if positives < MIN_EVALS_PER_SIDE or len(cases) - positives < MIN_EVALS_PER_SIDE:
        errors.append(f"evals/{path.name} needs at least {MIN_EVALS_PER_SIDE} should- and should-not-trigger cases")


def check_plugin_manifests(errors):
    """The Claude Code marketplace entry must name the plugin and point at this repository root."""
    manifests = {}
    for name in ("plugin.json", "marketplace.json"):
        try:
            manifests[name] = json.loads((ROOT / ".claude-plugin" / name).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f".claude-plugin/{name}: {exc}")
    if len(manifests) == 2:
        plugin_name = manifests["plugin.json"].get("name")
        entries = manifests["marketplace.json"].get("plugins", [])
        if not any(e.get("name") == plugin_name and e.get("source") == "./" for e in entries):
            errors.append(f"marketplace.json needs a plugins entry named '{plugin_name}' with source './'")


def main():
    fix = "--fix" in sys.argv[1:]
    failures = {}
    manifest_errors = []
    check_plugin_manifests(manifest_errors)
    if manifest_errors:
        failures["plugin"] = manifest_errors
    skill_dirs = sorted(p for p in SKILLS.iterdir() if p.is_dir())
    for skill_dir in skill_dirs:
        errors = []
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            errors.append("missing SKILL.md")
        else:
            text = skill_md.read_text(encoding="utf-8")
            check_frontmatter(skill_dir, text, errors)
            if text.count("\n") + 1 > MAX_SKILL_LINES:
                errors.append(f"SKILL.md exceeds {MAX_SKILL_LINES} lines; move detail into references/")
            check_references(skill_dir, errors)
        check_shared_copies(skill_dir, fix, errors)
        check_scripts(skill_dir, errors)
        check_evals(skill_dir, errors)
        if errors:
            failures[skill_dir.name] = errors

    known = {p.name for p in skill_dirs}
    for orphan in sorted(p.stem for p in EVALS.glob("*.json") if p.stem not in known):
        failures.setdefault("evals", []).append(f"evals/{orphan}.json has no matching skill")

    for name, errors in failures.items():
        print(f"FAIL {name}")
        for error in errors:
            print(f"  - {error}")
    print(f"{len(skill_dirs) - len(failures.keys() - {'evals', 'plugin'})}/{len(skill_dirs)} skills valid")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
