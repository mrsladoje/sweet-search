/* tslint:disable */
/* eslint-disable */

/**
 * Route labels
 */
export enum RouteMode {
  Lexical = 0,
  Semantic = 1,
  Hybrid = 2,
}

export class RouteResult {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  readonly mode_str: string;
  mode: RouteMode;
  confidence: number;
  rejected: boolean;
}

/**
 * Export features for debugging
 */
export function extract_features_js(query: string): Float32Array;

/**
 * Initialize panic hook for better error messages
 */
export function init(): void;

/**
 * Main entry point - route a query string
 */
export function route_query(query: string): RouteResult;
