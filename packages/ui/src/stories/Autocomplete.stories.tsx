import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, within } from "storybook/test";
import { Autocomplete } from "../components/Autocomplete";

const meta = {
  title: "Components/Autocomplete",
  component: Autocomplete.Root,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Autocomplete.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

const tags = [
  "React",
  "Vue",
  "Angular",
  "Svelte",
  "Next.js",
  "Nuxt",
  "Remix",
  "Astro",
  "SolidJS",
  "Preact",
];

export const Default: Story = {
  render: () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        border: "1px solid hsl(var(--input))",
        borderRadius: "var(--radius)",
        width: "280px",
      }}
    >
      <Autocomplete.Root items={tags}>
        <Autocomplete.Input placeholder="Search frameworks..." />
        <Autocomplete.Portal>
          <Autocomplete.Positioner sideOffset={4}>
            <Autocomplete.Popup>
              <Autocomplete.List>
                {(item: string) => (
                  <Autocomplete.Item value={item} key={item}>
                    {item}
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
              <Autocomplete.Empty>No frameworks found</Autocomplete.Empty>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByPlaceholderText("Search frameworks..."));
    await userEvent.type(canvas.getByPlaceholderText("Search frameworks..."), "Re");
    await expect(await screen.findByText("React")).toBeInTheDocument();
  },
};

interface City {
  name: string;
  country: string;
}

const cities: City[] = [
  { name: "New York", country: "USA" },
  { name: "Los Angeles", country: "USA" },
  { name: "Chicago", country: "USA" },
  { name: "London", country: "UK" },
  { name: "Manchester", country: "UK" },
  { name: "Paris", country: "France" },
  { name: "Lyon", country: "France" },
  { name: "Tokyo", country: "Japan" },
  { name: "Osaka", country: "Japan" },
];

export const WithObjects: Story = {
  render: () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        border: "1px solid hsl(var(--input))",
        borderRadius: "var(--radius)",
        width: "280px",
      }}
    >
      <Autocomplete.Root items={cities}>
        <Autocomplete.Input placeholder="Search cities..." />
        <Autocomplete.Portal>
          <Autocomplete.Positioner sideOffset={4}>
            <Autocomplete.Popup>
              <Autocomplete.List>
                {(city: City) => (
                  <Autocomplete.Item value={city} key={city.name}>
                    <div>
                      <div style={{ fontWeight: 500 }}>{city.name}</div>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "hsl(var(--muted-foreground))",
                        }}
                      >
                        {city.country}
                      </div>
                    </div>
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
              <Autocomplete.Empty>No cities found</Autocomplete.Empty>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>
    </div>
  ),
};

export const WithGroups: Story = {
  render: () => {
    const groupedCities = cities.reduce(
      (acc, city) => {
        if (!acc[city.country]) {
          acc[city.country] = [];
        }
        acc[city.country].push(city);
        return acc;
      },
      {} as Record<string, City[]>,
    );

    const groups = Object.entries(groupedCities).map(([country, items]) => ({
      value: country,
      items,
    }));

    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          border: "1px solid hsl(var(--input))",
          borderRadius: "var(--radius)",
          width: "280px",
        }}
      >
        <Autocomplete.Root items={groups}>
          <Autocomplete.Input placeholder="Search cities..." />
          <Autocomplete.Portal>
            <Autocomplete.Positioner sideOffset={4}>
              <Autocomplete.Popup>
                <Autocomplete.List>
                  {(group: { value: string; items: City[] }) => (
                    <Autocomplete.Group items={group.items} key={group.value}>
                      <Autocomplete.GroupLabel>{group.value}</Autocomplete.GroupLabel>
                      {group.items.map((city) => (
                        <Autocomplete.Item value={city} key={city.name}>
                          {city.name}
                        </Autocomplete.Item>
                      ))}
                    </Autocomplete.Group>
                  )}
                </Autocomplete.List>
                <Autocomplete.Empty>No cities found</Autocomplete.Empty>
              </Autocomplete.Popup>
            </Autocomplete.Positioner>
          </Autocomplete.Portal>
        </Autocomplete.Root>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByPlaceholderText("Search cities..."));
    await userEvent.type(canvas.getByPlaceholderText("Search cities..."), "Lo");

    await expect(await screen.findByText("London")).toBeInTheDocument();
    await expect(screen.getByText("Los Angeles")).toBeInTheDocument();
  },
};

export const SearchField: Story = {
  render: () => (
    <div style={{ width: "320px" }}>
      <label
        style={{
          display: "block",
          marginBottom: "0.5rem",
          fontSize: "0.875rem",
          fontWeight: 500,
        }}
      >
        Search
      </label>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          border: "1px solid hsl(var(--input))",
          borderRadius: "var(--radius)",
        }}
      >
        <span style={{ paddingLeft: "0.75rem", color: "hsl(var(--muted-foreground))" }}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <Autocomplete.Root items={tags}>
          <Autocomplete.Input placeholder="Type to search..." />
          <Autocomplete.Portal>
            <Autocomplete.Positioner sideOffset={4}>
              <Autocomplete.Popup>
                <Autocomplete.List>
                  {(item: string) => (
                    <Autocomplete.Item value={item} key={item}>
                      {item}
                    </Autocomplete.Item>
                  )}
                </Autocomplete.List>
                <Autocomplete.Empty>No results found</Autocomplete.Empty>
              </Autocomplete.Popup>
            </Autocomplete.Positioner>
          </Autocomplete.Portal>
        </Autocomplete.Root>
      </div>
      <p
        style={{
          marginTop: "0.5rem",
          fontSize: "0.75rem",
          color: "hsl(var(--muted-foreground))",
        }}
      >
        Try searching for React, Vue, or Angular.
      </p>
    </div>
  ),
};

export const WithClear: Story = {
  render: () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        border: "1px solid hsl(var(--input))",
        borderRadius: "var(--radius)",
        width: "280px",
      }}
    >
      <Autocomplete.Root items={tags} defaultValue="React">
        <Autocomplete.Input placeholder="Search frameworks..." />
        <Autocomplete.Clear aria-label="Clear selection">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </Autocomplete.Clear>
        <Autocomplete.Portal>
          <Autocomplete.Positioner sideOffset={4}>
            <Autocomplete.Popup>
              <Autocomplete.List>
                {(item: string) => (
                  <Autocomplete.Item value={item} key={item}>
                    {item}
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
              <Autocomplete.Empty>No frameworks found</Autocomplete.Empty>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>
    </div>
  ),
};
