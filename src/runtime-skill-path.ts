import path from 'node:path'

const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/

/**
 * Resolve runtime-agent skills from the source tree shipped to production.
 *
 * The service runs TypeScript directly from `src/`, but `import.meta.url` can
 * point at either a source file or a compiled file. Anchoring the default at
 * the service working directory keeps both development and production
 * deterministic. Operators can override the root for packaged deployments.
 */
export function runtimeSkillsDir(cwd = process.cwd()): string {
  return path.resolve(cwd, process.env.AGENT_SKILLS_DIR ?? 'src/skills')
}

export function runtimeSkillPath(name: string, cwd = process.cwd()): string {
  if (!SKILL_NAME.test(name)) throw new Error(`Invalid runtime skill name: ${name}`)
  return path.join(runtimeSkillsDir(cwd), name)
}
