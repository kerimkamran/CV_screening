import '@testing-library/jest-dom/vitest';
import { loadAz } from './i18n';

// Unit tests switch language synchronously: the Azerbaijani file is loaded before any test runs.
await loadAz();
