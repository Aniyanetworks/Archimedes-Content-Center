import { createDemoApi } from './demoApi';
import { createSupabaseApi } from './supabaseApi';
import type { Api } from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const api: Api = url && anonKey ? createSupabaseApi(url, anonKey) : createDemoApi();
