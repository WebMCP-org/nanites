import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import {
  Slider,
  SliderControl,
  SliderTrack,
  SliderIndicator,
  SliderThumb,
  SliderOutput,
} from "../components/Slider";
import { Label } from "../components/Label";

const meta: Meta<typeof Slider> = {
  title: "Components/Slider",
  component: Slider,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Slider>;

export const Default: Story = {
  render: () => (
    <div style={{ width: "300px" }}>
      <Slider defaultValue={50}>
        <SliderControl>
          <SliderTrack>
            <SliderIndicator />
            <SliderThumb aria-label="Slider" />
          </SliderTrack>
        </SliderControl>
      </Slider>
    </div>
  ),
};

export const WithOutput: Story = {
  render: () => (
    <div style={{ width: "300px" }}>
      <Slider defaultValue={50}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <Label>Volume</Label>
          <SliderOutput />
        </div>
        <SliderControl>
          <SliderTrack>
            <SliderIndicator />
            <SliderThumb aria-label="Volume" />
          </SliderTrack>
        </SliderControl>
      </Slider>
    </div>
  ),
};

export const MinMax: Story = {
  name: "Custom Range",
  render: () => (
    <div style={{ width: "300px" }}>
      <Slider defaultValue={500} min={100} max={1000} step={50}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <Label>Price</Label>
          <SliderOutput>{(value) => `$${value}`}</SliderOutput>
        </div>
        <SliderControl>
          <SliderTrack>
            <SliderIndicator />
            <SliderThumb aria-label="Price" />
          </SliderTrack>
        </SliderControl>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "0.25rem",
            fontSize: "0.75rem",
            color: "hsl(var(--muted-foreground))",
          }}
        >
          <span>$100</span>
          <span>$1000</span>
        </div>
      </Slider>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div style={{ width: "300px" }}>
      <Slider defaultValue={30} disabled>
        <SliderControl>
          <SliderTrack>
            <SliderIndicator />
            <SliderThumb aria-label="Disabled slider" />
          </SliderTrack>
        </SliderControl>
      </Slider>
    </div>
  ),
};

export const Controlled: Story = {
  render: () => {
    const [value, setValue] = React.useState(25);
    return (
      <div style={{ width: "300px" }}>
        <Slider value={value} onValueChange={(v) => setValue(Array.isArray(v) ? v[0] : v)}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <Label>Brightness</Label>
            <span
              style={{
                fontSize: "0.875rem",
                fontWeight: 500,
                fontVariantNumeric: "tabular-nums",
                color: "hsl(var(--foreground))",
              }}
            >
              {value}%
            </span>
          </div>
          <SliderControl>
            <SliderTrack>
              <SliderIndicator />
              <SliderThumb aria-label="Brightness" />
            </SliderTrack>
          </SliderControl>
        </Slider>
      </div>
    );
  },
};

function calculatePrice(calls: number) {
  if (calls <= 10000) return 0;
  if (calls <= 50000) return 29;
  if (calls <= 100000) return 79;
  return 199;
}

function formatNumber(num: number) {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(0)}K`;
  return num.toString();
}

export const UsageCalculator: Story = {
  name: "Usage-Based Pricing Calculator",
  render: () => {
    const [apiCalls, setApiCalls] = React.useState(50000);

    const price = calculatePrice(apiCalls);

    return (
      <div style={{ width: "400px" }}>
        <div
          style={{
            padding: "1.5rem",
            border: "1px solid hsl(var(--border))",
            borderRadius: "var(--radius)",
            backgroundColor: "hsl(var(--card))",
          }}
        >
          <h3
            style={{
              fontSize: "1.125rem",
              fontWeight: 600,
              marginBottom: "1.5rem",
              color: "hsl(var(--foreground))",
            }}
          >
            Estimate your usage
          </h3>

          <Slider
            value={apiCalls}
            onValueChange={(v) => setApiCalls(Array.isArray(v) ? v[0] : v)}
            min={0}
            max={500000}
            step={10000}
          >
            <div
              style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.75rem" }}
            >
              <Label>Monthly API Calls</Label>
              <span
                style={{
                  fontSize: "1rem",
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  color: "hsl(var(--primary))",
                }}
              >
                {formatNumber(apiCalls)}
              </span>
            </div>
            <SliderControl>
              <SliderTrack>
                <SliderIndicator />
                <SliderThumb aria-label="Monthly API calls" />
              </SliderTrack>
            </SliderControl>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: "0.5rem",
                fontSize: "0.75rem",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              <span>0</span>
              <span>500K</span>
            </div>
          </Slider>

          <div
            style={{
              marginTop: "1.5rem",
              paddingTop: "1.5rem",
              borderTop: "1px solid hsl(var(--border))",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <span
              style={{
                fontSize: "0.875rem",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              Estimated monthly cost
            </span>
            <div>
              <span
                style={{
                  fontSize: "2rem",
                  fontWeight: 700,
                  color: "hsl(var(--foreground))",
                }}
              >
                ${price}
              </span>
              <span
                style={{
                  fontSize: "0.875rem",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                /month
              </span>
            </div>
          </div>

          {apiCalls <= 10000 && (
            <p
              style={{
                marginTop: "0.75rem",
                fontSize: "0.875rem",
                color: "hsl(var(--success))",
                fontWeight: 500,
              }}
            >
              Free tier includes 10K API calls/month
            </p>
          )}
        </div>
      </div>
    );
  },
};

export const RangeSlider: Story = {
  name: "Range Slider",
  render: () => {
    const [range, setRange] = React.useState<number[]>([200, 800]);
    return (
      <div style={{ width: "300px" }}>
        <Slider
          value={range}
          onValueChange={(v) => setRange(Array.isArray(v) ? [...v] : [v])}
          min={0}
          max={1000}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <Label>Price Range</Label>
            <span
              style={{
                fontSize: "0.875rem",
                fontWeight: 500,
                fontVariantNumeric: "tabular-nums",
                color: "hsl(var(--foreground))",
              }}
            >
              ${range[0]} - ${range[1]}
            </span>
          </div>
          <SliderControl>
            <SliderTrack>
              <SliderIndicator />
              <SliderThumb aria-label="Minimum price" />
              <SliderThumb aria-label="Maximum price" />
            </SliderTrack>
          </SliderControl>
        </Slider>
      </div>
    );
  },
};
