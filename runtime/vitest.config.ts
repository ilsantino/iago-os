import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			lines: 80,
			branches: 75,
			functions: 80,
			statements: 80,
			include: ["agent-runtime/**", "daemon/**", "telegram/**"],
			exclude: ["**/*.test.ts", "**/types.ts", "dist/**"],
		},
		include: ["**/*.test.ts"],
		passWithNoTests: false,
	},
});
