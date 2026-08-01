export interface ResolvedDockerVersions {
  mysql: string;
  postgres: string;
  mongo: string;
  node: string;
  redis: string;
  nginx: string;
}

export async function fetchLatestDockerTag(
  imageName: string,
  filterRegex: RegExp,
  fallback: string
): Promise<string> {
  try {
    const res = await fetch(`https://hub.docker.com/v2/repositories/library/${imageName}/tags?page_size=50`);
    if (!res.ok) return fallback;
    const data = await res.json();
    if (!data.results || !Array.isArray(data.results)) return fallback;

    const tags = data.results
      .map((r: { name: string }) => r.name)
      .filter((t: string) => filterRegex.test(t) && !t.includes('rc') && !t.includes('beta') && !t.includes('alpha'));

    return tags[0] || fallback;
  } catch {
    return fallback;
  }
}

export async function resolveAllDockerVersions(): Promise<ResolvedDockerVersions> {
  const [mysql, postgres, mongo, node, redis, nginx] = await Promise.all([
    fetchLatestDockerTag('mysql', /^\d+(\.\d+)?(\.\d+)?$/, '9.7'),
    fetchLatestDockerTag('postgres', /^\d+(\.\d+)?-alpine$/, '18.2-alpine'),
    fetchLatestDockerTag('mongo', /^\d+(\.\d+)?$/, '8.3'),
    fetchLatestDockerTag('node', /^\d+-alpine$/, '22-alpine'),
    fetchLatestDockerTag('redis', /^\d+-alpine$/, '7-alpine'),
    fetchLatestDockerTag('nginx', /^\d+(\.\d+)?-alpine$/, '1.27-alpine')
  ]);

  return {
    mysql,
    postgres,
    mongo,
    node,
    redis,
    nginx
  };
}
