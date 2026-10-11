// Playwright forces colors in workers and web servers. Avoid passing a conflicting
// NO_COLOR flag to those child processes; this only changes the test runner's env.
delete process.env.NO_COLOR
