// Supabase Database type — must match the shape @supabase/supabase-js expects
export type Database = {
  public: {
    Tables: {
      users: {
        Row: { id: string; display_name: string }
        Insert: { id?: string; display_name: string }
        Update: { display_name?: string }
        Relationships: []
      }
      tournaments: {
        Row: {
          id: string
          name: string
          espn_event_id: string | null
          start_date: string
          end_date: string
        }
        Insert: {
          id?: string
          name: string
          espn_event_id?: string | null
          start_date: string
          end_date: string
        }
        Update: {
          name?: string
          espn_event_id?: string | null
          start_date?: string
          end_date?: string
        }
        Relationships: []
      }
      series: {
        Row: { id: string; name: string; year: number | null; created_at: string }
        Insert: { id?: string; name: string; year?: number | null }
        Update: { name?: string; year?: number | null }
        Relationships: []
      }
      leagues: {
        Row: {
          id: string
          name: string
          tournament_id: string
          status: 'drafting' | 'live' | 'completed'
          series_id: string | null
        }
        Insert: {
          id?: string
          name: string
          tournament_id: string
          status?: 'drafting' | 'live' | 'completed'
          series_id?: string | null
        }
        Update: {
          name?: string
          tournament_id?: string
          status?: 'drafting' | 'live' | 'completed'
          series_id?: string | null
        }
        Relationships: []
      }
      league_members: {
        Row: { league_id: string; user_id: string; draft_position: number }
        Insert: { league_id: string; user_id: string; draft_position: number }
        Update: { draft_position?: number }
        Relationships: []
      }
      players: {
        Row: { id: string; name: string; espn_player_id: string | null }
        Insert: { id?: string; name: string; espn_player_id?: string | null }
        Update: { name?: string; espn_player_id?: string | null }
        Relationships: []
      }
      tournament_players: {
        Row: {
          tournament_id: string
          player_id: string
          status: 'active' | 'cut' | 'wd'
        }
        Insert: {
          tournament_id: string
          player_id: string
          status?: 'active' | 'cut' | 'wd'
        }
        Update: { status?: 'active' | 'cut' | 'wd' }
        Relationships: []
      }
      draft_state: {
        Row: {
          league_id: string
          round: number
          pick_number: number
          on_clock_user_id: string | null
          direction: number
          started_at: string
        }
        Insert: {
          league_id: string
          round?: number
          pick_number?: number
          on_clock_user_id?: string | null
          direction?: number
          started_at?: string
        }
        Update: {
          round?: number
          pick_number?: number
          on_clock_user_id?: string | null
          direction?: number
          started_at?: string
        }
        Relationships: []
      }
      picks: {
        Row: {
          id: string
          league_id: string
          pick_number: number
          round: number
          user_id: string
          player_id: string
          timestamp: string
        }
        Insert: {
          id?: string
          league_id: string
          pick_number: number
          round: number
          user_id: string
          player_id: string
          timestamp?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      player_scores: {
        Row: {
          tournament_id: string
          player_id: string
          total_strokes: number | null
          today_strokes: number | null
          thru: string | null
          position: string | null
          tee_time: string | null
          r1_strokes: number | null
          r2_strokes: number | null
          r3_strokes: number | null
          r4_strokes: number | null
          updated_at: string
        }
        Insert: {
          tournament_id: string
          player_id: string
          total_strokes?: number | null
          today_strokes?: number | null
          thru?: string | null
          position?: string | null
          tee_time?: string | null
          r1_strokes?: number | null
          r2_strokes?: number | null
          r3_strokes?: number | null
          r4_strokes?: number | null
          updated_at?: string
        }
        Update: {
          total_strokes?: number | null
          today_strokes?: number | null
          thru?: string | null
          position?: string | null
          tee_time?: string | null
          r1_strokes?: number | null
          r2_strokes?: number | null
          r3_strokes?: number | null
          r4_strokes?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      team_scores: {
        Row: {
          league_id: string
          user_id: string
          total_strokes: number | null
          rank: number | null
          updated_at: string
        }
        Insert: {
          league_id: string
          user_id: string
          total_strokes?: number | null
          rank?: number | null
          updated_at?: string
        }
        Update: {
          total_strokes?: number | null
          rank?: number | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      league_status: 'drafting' | 'live' | 'completed'
      player_status: 'active' | 'cut' | 'wd'
    }
    CompositeTypes: Record<string, never>
  }
}

// Application-level types
export interface LeagueWithTournament {
  id: string
  name: string
  status: 'drafting' | 'live' | 'completed'
  tournament: {
    id: string
    name: string
    espn_event_id: string | null
    start_date: string
    end_date: string
  }
}

export interface DraftStateWithMembers {
  league_id: string
  round: number
  pick_number: number
  on_clock_user_id: string | null
  direction: number
  members: Array<{ user_id: string; draft_position: number; display_name: string }>
}

export interface PickWithPlayer {
  id: string
  pick_number: number
  round: number
  user_id: string
  player_id: string
  player_name: string
}

export interface AvailablePlayer {
  id: string
  name: string
  espn_player_id: string | null
  status: 'active' | 'cut' | 'wd'
  total_strokes: number | null
  position: string | null
  thru: string | null
}

export interface TeamStanding {
  user_id: string
  display_name: string
  total_strokes: number | null
  rank: number | null
  picks: Array<{
    player_id: string
    player_name: string
    draft_round: number
    total_strokes: number | null
    today_strokes: number | null
    thru: string | null
    position: string | null
    tee_time: string | null
    r1_strokes: number | null
    r2_strokes: number | null
    r3_strokes: number | null
    r4_strokes: number | null
  }>
}
