const { createClient } = require('@supabase/supabase-js');

const supabase = createClient('https://vdyrlmchoozeleeeqbxp.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkeXJsbWNob296ZWxlZWVxYnhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTY4NDksImV4cCI6MjA5MjY5Mjg0OX0.TUfIRqw3udv-obgF4fr4E5oY9JjiuYCuDhVfkjEjp_g');

async function test() {
  const { data, error } = await supabase.auth.signUp({
    email: 'test_12345@example.com',
    password: 'password123',
    options: {
      data: {
        username: 'testuser',
      },
    },
  });
  console.log("Signup Response:");
  console.log("Data:", data);
  console.log("Error:", error);
}

test();
