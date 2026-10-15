export type ImageVariant = 'thumb' | 'display' | 'original';

export function imageUrl(url: string, variant: ImageVariant): string {
  if (!url.startsWith('/api/images/')) return url;
  const [path, query = ''] = url.split('?', 2);
  const params = new URLSearchParams(query);
  params.set('variant', variant);
  return `${path}?${params.toString()}`;
}
