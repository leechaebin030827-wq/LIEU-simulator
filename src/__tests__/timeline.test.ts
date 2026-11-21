import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { Timeline } from '../ui/Timeline';
import { useStore } from '../store';
import { validateSequence } from '../engine/project';

afterEach(() => vi.restoreAllMocks());
it('renders finite timeline geometry before and after loading every scenario', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  let html = renderToStaticMarkup(createElement(Timeline));
  expect(html).not.toContain('NaN');
  for (const id of ['01_boarding', '02_driving_a', '03_arrival', '04_driving_b', '05_web_cover', '07_bonus_aegyo', '08_exhibition_final']) {
    useStore.getState().loadSequence(validateSequence(JSON.parse(readFileSync(`examples/${id}.lieu.json`, 'utf8'))));
    html = renderToStaticMarkup(createElement(Timeline));
    expect(html, id).not.toContain('NaN');
  }
  expect(error).not.toHaveBeenCalled();
});
