
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "age_assurance": {
                  Row: {
                    "blocked": boolean,"declared_at": string | null,"declared_bracket": string | null,"effective_bracket": string,"profile_id": string,"signal_at": string | null,"signal_bracket": string | null,"signal_source": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "blocked"?: boolean,"declared_at"?: string | null,"declared_bracket"?: string | null,"effective_bracket": string,"profile_id": string,"signal_at"?: string | null,"signal_bracket"?: string | null,"signal_source"?: string,"updated_at"?: string
                  }
                  Update: {
                    "blocked"?: boolean,"declared_at"?: string | null,"declared_bracket"?: string | null,"effective_bracket"?: string,"profile_id"?: string,"signal_at"?: string | null,"signal_bracket"?: string | null,"signal_source"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "age_assurance_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"asset_index": {
                  Row: {
                    "ref": string,"sha256": string,"status": string,"tags": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "ref": string,"sha256": string,"status": string,"tags"?: (string)[]
                  }
                  Update: {
                    "ref"?: string,"sha256"?: string,"status"?: string,"tags"?: (string)[]
                  }
                  Relationships: [
                    
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor": string,"at": string,"details": NonNullable<Json>,"id": number,"prev_hash": string | null,"role": string,"row_hash": string,"target_id": string | null,"target_kind": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor": string,"at"?: string,"details"?: NonNullable<Json>,"id"?: never,"prev_hash"?: string | null,"role": string,"row_hash": string,"target_id"?: string | null,"target_kind"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor"?: string,"at"?: string,"details"?: NonNullable<Json>,"id"?: never,"prev_hash"?: string | null,"role"?: string,"row_hash"?: string,"target_id"?: string | null,"target_kind"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"bark_index": {
                  Row: {
                    "key": string,"voice_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"voice_id": string
                  }
                  Update: {
                    "key"?: string,"voice_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"budget_daily": {
                  Row: {
                    "ceiling_usd_micros": number,"day": string,"max_level": number,"spent_usd_micros": number,"vendor": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ceiling_usd_micros": number,"day": string,"max_level": number,"spent_usd_micros": number,"vendor": string
                  }
                  Update: {
                    "ceiling_usd_micros"?: number,"day"?: string,"max_level"?: number,"spent_usd_micros"?: number,"vendor"?: string
                  }
                  Relationships: [
                    
                  ]
                },"budget_program": {
                  Row: {
                    "alarms": (number)[],"cap_usd_micros": number,"vendor": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alarms"?: (number)[],"cap_usd_micros": number,"vendor": string
                  }
                  Update: {
                    "alarms"?: (number)[],"cap_usd_micros"?: number,"vendor"?: string
                  }
                  Relationships: [
                    
                  ]
                },"consent_event": {
                  Row: {
                    "actor": string | null,"at": string,"consent_id": string | null,"details": Json | null,"id": number,"kind": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor"?: string | null,"at"?: string,"consent_id"?: string | null,"details"?: Json | null,"id"?: never,"kind"?: string | null
                  }
                  Update: {
                    "actor"?: string | null,"at"?: string,"consent_id"?: string | null,"details"?: Json | null,"id"?: never,"kind"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "consent_event_consent_id_fkey"
      columns: ["consent_id"]
isOneToOne: false
      referencedRelation: "consent_record"
      referencedColumns: ["id"]
    }
                  ]
                },"consent_record": {
                  Row: {
                    "approved_at": string,"approved_by": string,"compensation_ref": string | null,"counsel_represented": boolean,"evidence_r2_key": string,"evidence_sha256": string,"id": string,"media": (string)[],"revocable": boolean,"revocation_terms": string,"revoked_at": string | null,"revoked_reason": string | null,"scopes": (string)[],"signatory_capacity": string,"signatory_name": string,"subject_id": string,"term_end": string | null,"term_start": string,"territory": string,"union_covered": boolean,"use_description": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at": string,"approved_by": string,"compensation_ref"?: string | null,"counsel_represented": boolean,"evidence_r2_key": string,"evidence_sha256": string,"id": string,"media": (string)[],"revocable"?: boolean,"revocation_terms": string,"revoked_at"?: string | null,"revoked_reason"?: string | null,"scopes": (string)[],"signatory_capacity": string,"signatory_name": string,"subject_id": string,"term_end"?: string | null,"term_start": string,"territory"?: string,"union_covered"?: boolean,"use_description": string
                  }
                  Update: {
                    "approved_at"?: string,"approved_by"?: string,"compensation_ref"?: string | null,"counsel_represented"?: boolean,"evidence_r2_key"?: string,"evidence_sha256"?: string,"id"?: string,"media"?: (string)[],"revocable"?: boolean,"revocation_terms"?: string,"revoked_at"?: string | null,"revoked_reason"?: string | null,"scopes"?: (string)[],"signatory_capacity"?: string,"signatory_name"?: string,"subject_id"?: string,"term_end"?: string | null,"term_start"?: string,"territory"?: string,"union_covered"?: boolean,"use_description"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "consent_record_subject_id_fkey"
      columns: ["subject_id"]
isOneToOne: false
      referencedRelation: "likeness_subject"
      referencedColumns: ["id"]
    }
                  ]
                },"cutscene_catalog": {
                  Row: {
                    "added_at": string,"cache_key": string,"characters": (string)[],"priority": number,"source": string,"template_id": string,"template_ver": number
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"cache_key": string,"characters": (string)[],"priority"?: number,"source": string,"template_id": string,"template_ver": number
                  }
                  Update: {
                    "added_at"?: string,"cache_key"?: string,"characters"?: (string)[],"priority"?: number,"source"?: string,"template_id"?: string,"template_ver"?: number
                  }
                  Relationships: [
                    
                  ]
                },"cutscenes": {
                  Row: {
                    "cache_key": string,"char_ids": (string)[],"cost_usd_micros": number | null,"created_at": string,"endpoint_id": string,"endpoint_updated_at": string,"error": string | null,"provider_request_id": string | null,"r2_prefix": string,"ready_at": string | null,"status": string,"workflow_instance": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cache_key": string,"char_ids"?: (string)[],"cost_usd_micros"?: number | null,"created_at"?: string,"endpoint_id": string,"endpoint_updated_at": string,"error"?: string | null,"provider_request_id"?: string | null,"r2_prefix": string,"ready_at"?: string | null,"status": string,"workflow_instance": string
                  }
                  Update: {
                    "cache_key"?: string,"char_ids"?: (string)[],"cost_usd_micros"?: number | null,"created_at"?: string,"endpoint_id"?: string,"endpoint_updated_at"?: string,"error"?: string | null,"provider_request_id"?: string | null,"r2_prefix"?: string,"ready_at"?: string | null,"status"?: string,"workflow_instance"?: string
                  }
                  Relationships: [
                    
                  ]
                },"device_keys": {
                  Row: {
                    "created_at": string,"kid": string,"last_used_at": string | null,"profile_id": string,"public_jwk": NonNullable<Json>,"revoked_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"kid": string,"last_used_at"?: string | null,"profile_id": string,"public_jwk": NonNullable<Json>,"revoked_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"kid"?: string,"last_used_at"?: string | null,"profile_id"?: string,"public_jwk"?: NonNullable<Json>,"revoked_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "device_keys_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"encounter_transcripts": {
                  Row: {
                    "closed_at": string,"encounter_id": string,"expires_at": string,"npc_id": string,"profile_id": string,"r2_key": string,"turns": number,"usd_micros": number
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at": string,"encounter_id": string,"expires_at": string,"npc_id": string,"profile_id": string,"r2_key": string,"turns": number,"usd_micros": number
                  }
                  Update: {
                    "closed_at"?: string,"encounter_id"?: string,"expires_at"?: string,"npc_id"?: string,"profile_id"?: string,"r2_key"?: string,"turns"?: number,"usd_micros"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "encounter_transcripts_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"gen_job": {
                  Row: {
                    "asset_ref": string,"budget_usd_micros": number,"cost_usd_micros": number | null,"created_at": string,"endpoint_key": string,"env": string,"id": string,"job_key": string,"kind": string,"request_id": string | null,"run_id": string | null,"settled_at": string | null,"state": string
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_ref": string,"budget_usd_micros": number,"cost_usd_micros"?: number | null,"created_at"?: string,"endpoint_key": string,"env": string,"id": string,"job_key": string,"kind": string,"request_id"?: string | null,"run_id"?: string | null,"settled_at"?: string | null,"state": string
                  }
                  Update: {
                    "asset_ref"?: string,"budget_usd_micros"?: number,"cost_usd_micros"?: number | null,"created_at"?: string,"endpoint_key"?: string,"env"?: string,"id"?: string,"job_key"?: string,"kind"?: string,"request_id"?: string | null,"run_id"?: string | null,"settled_at"?: string | null,"state"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "gen_job_run_id_fkey"
      columns: ["run_id"]
isOneToOne: false
      referencedRelation: "gen_run"
      referencedColumns: ["id"]
    }
                  ]
                },"gen_run": {
                  Row: {
                    "budget_usd_micros": number,"closed_at": string | null,"created_at": string,"env": string,"id": string,"requested_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "budget_usd_micros": number,"closed_at"?: string | null,"created_at"?: string,"env": string,"id": string,"requested_by": string
                  }
                  Update: {
                    "budget_usd_micros"?: number,"closed_at"?: string | null,"created_at"?: string,"env"?: string,"id"?: string,"requested_by"?: string
                  }
                  Relationships: [
                    
                  ]
                },"genai_ledger": {
                  Row: {
                    "env": string,"id": number,"job_id": string | null,"kind": string,"model": string,"request_id": string | null,"settled": boolean,"ts": string,"usd_micros": number,"vendor": string
                  }
                  ComputedFields: never
                  Insert: {
                    "env": string,"id"?: never,"job_id"?: string | null,"kind": string,"model": string,"request_id"?: string | null,"settled": boolean,"ts": string,"usd_micros": number,"vendor": string
                  }
                  Update: {
                    "env"?: string,"id"?: never,"job_id"?: string | null,"kind"?: string,"model"?: string,"request_id"?: string | null,"settled"?: boolean,"ts"?: string,"usd_micros"?: number,"vendor"?: string
                  }
                  Relationships: [
                    
                  ]
                },"idempotency_keys": {
                  Row: {
                    "created_at": string,"key": string,"profile_id": string | null,"response": NonNullable<Json>,"route": string,"status": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"key": string,"profile_id"?: string | null,"response": NonNullable<Json>,"route": string,"status": number
                  }
                  Update: {
                    "created_at"?: string,"key"?: string,"profile_id"?: string | null,"response"?: NonNullable<Json>,"route"?: string,"status"?: number
                  }
                  Relationships: [
                    
                  ]
                },"identities": {
                  Row: {
                    "created_at": string,"last_used_at": string | null,"profile_id": string,"provider": string,"subject": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"last_used_at"?: string | null,"profile_id": string,"provider": string,"subject": string
                  }
                  Update: {
                    "created_at"?: string,"last_used_at"?: string | null,"profile_id"?: string,"provider"?: string,"subject"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "identities_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"likeness_subject": {
                  Row: {
                    "aliases": (string)[],"created_at": string,"deceased": boolean,"default_tier": string,"died_on": string | null,"estate_contact": string | null,"id": string,"marks": (string)[],"notes": string | null,"real_name": string,"sos_registration_ref": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "aliases"?: (string)[],"created_at"?: string,"deceased"?: boolean,"default_tier": string,"died_on"?: string | null,"estate_contact"?: string | null,"id": string,"marks"?: (string)[],"notes"?: string | null,"real_name": string,"sos_registration_ref"?: string | null
                  }
                  Update: {
                    "aliases"?: (string)[],"created_at"?: string,"deceased"?: boolean,"default_tier"?: string,"died_on"?: string | null,"estate_contact"?: string | null,"id"?: string,"marks"?: (string)[],"notes"?: string | null,"real_name"?: string,"sos_registration_ref"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"npc_memory": {
                  Row: {
                    "created_at": string,"embedding": unknown,"expires_at": string,"game_time": number,"id": number,"importance": number,"kind": string,"last_accessed_at": string | null,"npc_id": string,"profile_id": string,"scope": string,"source": string,"text": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"embedding": unknown,"expires_at"?: string,"game_time": number,"id"?: never,"importance": number,"kind": string,"last_accessed_at"?: string | null,"npc_id": string,"profile_id": string,"scope": string,"source": string,"text": string
                  }
                  Update: {
                    "created_at"?: string,"embedding"?: unknown,"expires_at"?: string,"game_time"?: number,"id"?: never,"importance"?: number,"kind"?: string,"last_accessed_at"?: string | null,"npc_id"?: string,"profile_id"?: string,"scope"?: string,"source"?: string,"text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "npc_memory_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"npc_relationship": {
                  Row: {
                    "affinity": number,"encounters": number,"flags": NonNullable<Json>,"last_seen_at": string,"npc_id": string,"profile_id": string,"soul_version": number,"summary": string,"trust": number
                  }
                  ComputedFields: never
                  Insert: {
                    "affinity"?: number,"encounters"?: number,"flags"?: NonNullable<Json>,"last_seen_at"?: string,"npc_id": string,"profile_id": string,"soul_version": number,"summary"?: string,"trust"?: number
                  }
                  Update: {
                    "affinity"?: number,"encounters"?: number,"flags"?: NonNullable<Json>,"last_seen_at"?: string,"npc_id"?: string,"profile_id"?: string,"soul_version"?: number,"summary"?: string,"trust"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "npc_relationship_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"display_name": string | null,"display_name_state": string,"flags": NonNullable<Json>,"id": string,"last_seen_at": string,"registered_at": string | null,"tier": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"display_name"?: string | null,"display_name_state"?: string,"flags"?: NonNullable<Json>,"id": string,"last_seen_at"?: string,"registered_at"?: string | null,"tier"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"display_name"?: string | null,"display_name_state"?: string,"flags"?: NonNullable<Json>,"id"?: string,"last_seen_at"?: string,"registered_at"?: string | null,"tier"?: string
                  }
                  Relationships: [
                    
                  ]
                },"refresh_tokens": {
                  Row: {
                    "aud": string,"expires_at": string,"family": string,"issued_at": string,"profile_id": string,"revoked_at": string | null,"token_hash": string,"used_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "aud"?: string,"expires_at": string,"family": string,"issued_at"?: string,"profile_id": string,"revoked_at"?: string | null,"token_hash": string,"used_at"?: string | null
                  }
                  Update: {
                    "aud"?: string,"expires_at"?: string,"family"?: string,"issued_at"?: string,"profile_id"?: string,"revoked_at"?: string | null,"token_hash"?: string,"used_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "refresh_tokens_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"roster_flag": {
                  Row: {
                    "killed": boolean,"npc_id": string,"reason": string | null,"scope": (string)[],"set_at": string,"set_by": string,"stand_in": string,"ticket_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "killed"?: boolean,"npc_id": string,"reason"?: string | null,"scope"?: (string)[],"set_at"?: string,"set_by": string,"stand_in": string,"ticket_id"?: string | null
                  }
                  Update: {
                    "killed"?: boolean,"npc_id"?: string,"reason"?: string | null,"scope"?: (string)[],"set_at"?: string,"set_by"?: string,"stand_in"?: string,"ticket_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"staff_roles": {
                  Row: {
                    "granted_at": string,"granted_by": string,"profile_id": string,"scope": string
                  }
                  ComputedFields: never
                  Insert: {
                    "granted_at"?: string,"granted_by": string,"profile_id": string,"scope": string
                  }
                  Update: {
                    "granted_at"?: string,"granted_by"?: string,"profile_id"?: string,"scope"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_roles_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"telemetry_daily": {
                  Row: {
                    "build": string,"count": number,"day": string,"device_class": string,"metrics": NonNullable<Json>,"name": string,"os_major": number,"tier": string
                  }
                  ComputedFields: never
                  Insert: {
                    "build": string,"count": number,"day": string,"device_class": string,"metrics": NonNullable<Json>,"name": string,"os_major": number,"tier": string
                  }
                  Update: {
                    "build"?: string,"count"?: number,"day"?: string,"device_class"?: string,"metrics"?: NonNullable<Json>,"name"?: string,"os_major"?: number,"tier"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "match_npc_memories":
{ Args: { "k"?: number,"now_gt": number,"p_npc": string,"p_profile": string,"q": unknown }; Returns: {
              "id": number,"kind": string,"score": number,"text": string
            }[]
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
