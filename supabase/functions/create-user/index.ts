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

    // Parse request body. Roles stage 4c (owner 2026-10-27): the new user's
    // ONE role is `role_key` (any active role of the roles page), assigned
    // below through admin_assign_profile_role as the caller. `role` is the
    // name the screens used before and is accepted as the same key.
    const { email, password, full_name, role_key, role } = await req.json()
    const roleKey = String(role_key ?? role ?? '').trim()

    if (!email || !password || !full_name || !roleKey) {
      return new Response(
        JSON.stringify({
          error: 'Missing required fields: email, password, full_name, role_key',
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

    // The role must exist and be active before an account is created for it
    // (the assignment below re-checks it). Read as the caller: every
    // signed-in user may read `roles` (0126).
    const { data: targetRole, error: roleError } = await userClient
      .from('roles')
      .select('key,is_active')
      .eq('key', roleKey)
      .maybeSingle()
    if (roleError || !targetRole || targetRole.is_active !== true) {
      return new Response(
        JSON.stringify({ error: 'Invalid role', code: 'invalid_role' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // Use service role client to create the new user
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const { data: authData, error: createError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
        // Only the service role can write app_metadata. No role is sent
        // (roles stage 4c-2: migration 0156 drops profiles.role); the role
        // that decides is the assignment below.
        app_metadata: { admin_created: true },
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

    // The new user's role, as the caller (admin and settings.roles are
    // re-checked by the database). A failure never undoes the account: the
    // screen says the role was not assigned and it is set on the user page;
    // until then the user holds nothing (fail closed).
    const { error: assignError } = await userClient.rpc(
      'admin_assign_profile_role',
      { p_profile_id: authData.user.id, p_role_key: roleKey },
    )
    if (assignError) console.error('create-user role assignment failed')

    return new Response(
      JSON.stringify({
        message: 'User created successfully',
        user: { id: authData.user.id, email: authData.user.email },
        role_assigned: !assignError,
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
