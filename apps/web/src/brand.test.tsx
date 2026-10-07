import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Brand, BRAND_BY, BRAND_FULL, BRAND_NAME } from './brand';
import { App } from './App';

describe('brand (design spec 2)', () => {
  it('is lowercase "parallax by Azerconnect Group" everywhere the lockup appears', () => {
    expect(BRAND_NAME).toBe('parallax');
    expect(BRAND_FULL).toBe(`parallax ${BRAND_BY}`);
    render(<Brand />);
    expect(screen.getByLabelText('parallax by Azerconnect Group')).toBeInTheDocument();
  });
  it('can drop the endorsement line (Results header)', () => {
    render(<Brand compact />);
    expect(screen.getByLabelText('parallax')).toBeInTheDocument();
    expect(screen.queryByText(BRAND_BY)).not.toBeInTheDocument();
  });
  it('is in the header of the signed-out app', async () => {
    render(<App check={async () => ({ state: 'up' as const })} />);
    expect(await screen.findAllByLabelText('parallax by Azerconnect Group')).not.toHaveLength(0);
  });
  it('names the browser tab and has an icon', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('<title>parallax by Azerconnect Group</title>');
    expect(html).toContain('/favicon.svg');
  });
});
