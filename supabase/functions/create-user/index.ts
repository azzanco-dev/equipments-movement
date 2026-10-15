import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Client-Info, Apikey',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders })
  }

  try {
    // Verify the caller is authenticated and is an admin
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // The caller's own client (anon key + the caller's Authorization header):
    // it identifies the caller and decides what he may do. The service-role
    // client below is used only for the privileged write.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // wave 24: the caller needs the permission `users.manage`, decided by
    // public.has_permission() (migration 0126) evaluated AS THE CALLER. While
    // the roles system is inactive the frozen legacy mapping grants it to the
    // admin only, so nothing changes; once active the assigned role decides.
    // Fail closed: anything but exactly `true` (an error included) is 403.
    const { data: canManageUsers, error: permissionError } =
      await userClient.rpc('has_permission', { p_key: 'users.manage' })

    if (permissionError || canManageUsers !== true) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Parse request body
    const { email, password, full_name, role } = await req.json()

    if (!email || !password || !full_name || !role) {
      return new Response(
        JSON.stringify({
          error: 'Missing required fields: email, password, full_name, role',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (!/^\S+@\S+\.\S+$/.test(String(email).trim())) {
      return new Response(
        JSON.stringify({ error: 'Invalid email', code: 'invalid_email' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (String(password).length < 8) {
      return new Response(
        JSON.stringify({ error: 'Weak password', code: 'weak_password' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (
      ![
        'admin',
        'supervisor',
        'workshop',
        'assistant_workshop_manager',
        'workshop_manager',
        'monitor',
      ].includes(role)
    ) {
      return new Response(JSON.stringify({ error: 'Invalid role' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Use service role client to create the new user
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const { data: authData, error: createError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
        // Only the service role can write app_metadata; handle_new_user reads
        // the role from here, never from user-editable user_metadata.
        app_metadata: { role, admin_created: true },
      })

    if (createError) {
      console.error('createUser failed', createError)
      const code =
        createError.code === 'email_exists' ||
        createError.message.toLowerCase().includes('already')
          ? 'email_exists'
          : createError.code === 'email_address_invalid'
            ? 'invalid_email'
            : createError.code === 'weak_password'
              ? 'weak_password'
              : 'create_failed'
      return new Response(
        JSON.stringify({ error: 'Could not create the user', code }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    return new Response(
      JSON.stringify({
        message: 'User created successfully',
        user: { id: authData.user.id, email: authData.user.email },
      }),
      {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (err) {
    console.error('create-user failed', err)
    return new Response(JSON.stringify({ error: 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
