import { describe, expect, it } from 'vitest';
import { looksLikeInquiryRequest, looksLikePerformanceRequest } from './task-ui.js';

describe('task intent routing', () => {
  it.each([
    'tell me how this product works',
    'How does authentication work?',
    'explain the API architecture',
    'please summarize this repository',
  ])('recognizes repository questions: %s', (request) => {
    expect(looksLikeInquiryRequest(request)).toBe(true);
  });

  it.each([
    'make the API faster',
    'add authentication',
    'fix the broken login form',
    'implement a faster cache',
  ])('keeps change requests in implementation mode: %s', (request) => {
    expect(looksLikeInquiryRequest(request)).toBe(false);
  });

  it('does not confuse a question about performance with an optimization request', () => {
    const request = 'How does the performance benchmark work?';
    expect(looksLikeInquiryRequest(request)).toBe(true);
    expect(looksLikePerformanceRequest(request)).toBe(true);
  });
});
