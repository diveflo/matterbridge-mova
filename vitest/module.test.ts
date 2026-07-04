import initializePlugin, { MovaPlatform } from '../src/module.js';

describe('Matterbridge MOVA module', () => {
  it('exports the Matterbridge plugin entry point', () => {
    expect(typeof initializePlugin).toBe('function');
  });

  it('exports the MOVA platform class', () => {
    expect(typeof MovaPlatform).toBe('function');
  });
});
