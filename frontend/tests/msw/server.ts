// MSW node server condiviso da tutta la suite. Il ciclo di vita
// (listen / resetHandlers / close) è cablato in tests/setup.ts.
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
