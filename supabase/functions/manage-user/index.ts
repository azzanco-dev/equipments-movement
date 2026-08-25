import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: callerProfile } = await userClient.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const body = await req.json();

    if (body.action === "change_own_password") {
      const password = String(body.password ?? "");
      if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
      const { error: passwordError } = await adminClient.auth.admin.updateUserById(user.id, { password });
      if (passwordError) return json({ error: "Could not update password" }, 400);
      const { error: profileError } = await adminClient.from("profiles").update({ must_change_password: false }).eq("id", user.id);
      if (profileError) return json({ error: "Could not complete password change" }, 500);
      return json({ success: true });
    }

    if (callerProfile?.role !== "admin") return json({ error: "Forbidden" }, 403);
    const userId = String(body.user_id ?? "");
    if (!userId) return json({ error: "User is required" }, 400);

    if (body.action === "get") {
      const [{ data: authData, error: authError }, { data: profile, error: profileError }] = await Promise.all([
        adminClient.auth.admin.getUserById(userId),
        adminClient.from("profiles").select("id,full_name,role,project_id,created_at,must_change_password,project:projects(name_ar,name_en)").eq("id", userId).maybeSingle(),
      ]);
      if (authError || profileError || !authData.user || !profile) return json({ error: "User not found" }, 404);
      return json({ user: { ...profile, email: authData.user.email ?? "" } });
    }

    if (body.action === "update") {
      const fullName = String(body.full_name ?? "").trim();
      const email = String(body.email ?? "").trim();
      const password = String(body.password ?? "");
      const role = String(body.role ?? "");
      const projectId = body.project_id ? String(body.project_id) : null;
      if (!fullName || !email) return json({ error: "Name and email are required" }, 400);
      if (password && password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
      if (!["admin", "supervisor", "workshop", "assistant_workshop_manager", "workshop_manager"].includes(role)) return json({ error: "Invalid role" }, 400);
      if (role === "supervisor" && !projectId) return json({ error: "A project is required for foremen" }, 400);

      const authAttributes: { email: string; password?: string; email_confirm: boolean } = { email, email_confirm: true };
      if (password) authAttributes.password = password;
      const { error: authError } = await adminClient.auth.admin.updateUserById(userId, authAttributes);
      if (authError) return json({ error: "Could not update login details" }, 400);

      const profileUpdate: { full_name: string; role: string; project_id: string | null; must_change_password?: boolean } = { full_name: fullName, role, project_id: role === "supervisor" ? projectId : null };
      if (password) profileUpdate.must_change_password = true;
      const { error: profileError } = await adminClient.from("profiles").update(profileUpdate).eq("id", userId);
      if (profileError) return json({ error: "Could not update profile" }, 500);
      return json({ success: true });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (error) {
    console.error("manage-user failed", error);
    return json({ error: "Unexpected error" }, 500);
  }
});
