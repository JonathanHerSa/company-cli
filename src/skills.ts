import path from 'path';
import fs from 'fs-extra';

const SKILL_URLS = {
  graphify: [
    'https://raw.githubusercontent.com/safishamsi/graphify/main/skills/graphify/SKILL.md',
    'https://raw.githubusercontent.com/safishamsi/graphify/main/SKILL.md'
  ],
  impeccable: [
    'https://raw.githubusercontent.com/awesome-skills/impeccable/main/SKILL.md',
    'https://raw.githubusercontent.com/pbaca/impeccable/main/SKILL.md'
  ]
};

export async function downloadOnlineSkill(skillName: 'graphify' | 'impeccable', destDir: string): Promise<boolean> {
  const targetPath = path.join(destDir, 'SKILL.md');
  await fs.ensureDir(destDir);

  const urls = SKILL_URLS[skillName];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const text = await res.text();
        if (text && text.includes('name:')) {
          await fs.writeFile(targetPath, text, 'utf-8');
          return true;
        }
      }
    } catch {
      // Try next URL
    }
  }

  // Fallback: Copy from local system if available
  const localPath = `/home/t3zcadev/.gemini/config/plugins/user-skills/skills/${skillName}/SKILL.md`;
  if (await fs.pathExists(localPath)) {
    try {
      const text = await fs.readFile(localPath, 'utf-8');
      await fs.writeFile(targetPath, text, 'utf-8');
      return true;
    } catch {}
  }

  // Ultimate minimal fallback
  const minimalContent = skillName === 'graphify'
    ? `---\nname: graphify\ndescription: any input to knowledge graph.\ntrigger: /graphify\n---\n`
    : `---\nname: impeccable\ndescription: Design system & UI intelligence skill.\nversion: 4.0.2\n---\n`;
  
  await fs.writeFile(targetPath, minimalContent, 'utf-8');
  return false;
}
