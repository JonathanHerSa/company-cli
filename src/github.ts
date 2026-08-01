import { execa } from 'execa';
import { Octokit } from '@octokit/rest';

export interface GitHubOrg {
  login: string;
  description?: string;
}

export interface GitHubStatus {
  hasGhCli: boolean;
  isAuthenticated: boolean;
  username?: string;
  orgs: GitHubOrg[];
}

export async function checkGitHubStatus(): Promise<GitHubStatus> {
  let hasGhCli = false;
  let isAuthenticated = false;
  let username: string | undefined;
  const orgs: GitHubOrg[] = [];

  try {
    const { stdout: ghVersion } = await execa('gh', ['--version']);
    if (ghVersion.includes('gh version')) {
      hasGhCli = true;
    }
  } catch {
    hasGhCli = false;
  }

  if (hasGhCli) {
    try {
      const { stdout: authStatus } = await execa('gh', ['auth', 'status']);
      if (!authStatus.includes('Logged in to') && !authStatus.includes('Logged in to github.com')) {
        // try checking via api if auth status stdout format varies
      }
      isAuthenticated = true;

      // Get user username
      try {
        const { stdout: userResult } = await execa('gh', ['api', 'user', '-q', '.login']);
        username = userResult.trim();
      } catch {}

      // Get organizations list
      try {
        const { stdout: orgsResult } = await execa('gh', ['api', 'user/orgs', '-q', '.[].login']);
        const orgLogins = orgsResult.split('\n').map(o => o.trim()).filter(Boolean);
        for (const login of orgLogins) {
          orgs.push({ login });
        }
      } catch {}
    } catch {
      isAuthenticated = false;
    }
  }

  return {
    hasGhCli,
    isAuthenticated,
    username,
    orgs
  };
}

export async function getOrgsViaToken(token: string): Promise<{ username: string; orgs: GitHubOrg[] }> {
  const octokit = new Octokit({ auth: token });
  const { data: user } = await octokit.users.getAuthenticated();
  const { data: orgsData } = await octokit.orgs.listForAuthenticatedUser();
  return {
    username: user.login,
    orgs: orgsData.map(o => ({ login: o.login, description: o.description || undefined }))
  };
}

export async function createRemoteRepo(
  targetOrgOrUser: string,
  repoName: string,
  token?: string
): Promise<{ success: boolean; cloneUrl: string; error?: string }> {
  // Try gh cli first if available
  try {
    const isOrg = targetOrgOrUser !== '';
    const fullRepoPath = isOrg ? `${targetOrgOrUser}/${repoName}` : repoName;

    await execa('gh', ['repo', 'create', fullRepoPath, '--private', '--confirm'], { reject: true });
    
    // Default URL format
    const cloneUrl = `https://github.com/${fullRepoPath}.git`;
    return { success: true, cloneUrl };
  } catch (err: any) {
    // If PAT token is provided, try Octokit API
    if (token) {
      try {
        const octokit = new Octokit({ auth: token });
        let cloneUrl = '';
        
        // Try creating in org
        try {
          const res = await octokit.repos.createInOrg({
            org: targetOrgOrUser,
            name: repoName,
            private: true
          });
          cloneUrl = res.data.clone_url;
        } catch {
          // If org creation fails, try creating for user
          const res = await octokit.repos.createForAuthenticatedUser({
            name: repoName,
            private: true
          });
          cloneUrl = res.data.clone_url;
        }
        return { success: true, cloneUrl };
      } catch (tokenErr: any) {
        return { success: false, cloneUrl: '', error: tokenErr.message || String(tokenErr) };
      }
    }

    return { success: false, cloneUrl: '', error: err.message || String(err) };
  }
}
