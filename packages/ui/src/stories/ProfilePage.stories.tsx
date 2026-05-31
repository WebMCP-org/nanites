import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { Avatar } from "../components/Avatar";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Input } from "../components/Input";
import { Label } from "../components/Label";
import { Separator } from "../components/Separator";
import { Switch, SwitchThumb } from "../components/Switch";
import { Tabs, TabsList, Tab, TabPanel } from "../components/Tabs";
import { NavigationMenu } from "../components/NavigationMenu";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPortal,
  SelectPositioner,
  SelectPopup,
  SelectList,
  SelectOption,
} from "../components/Select";

const meta: Meta = {
  title: "Examples/ProfilePage",
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj;

const CameraIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

const MailIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

const MapPinIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

const CalendarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const LinkIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const Default: Story = {
  render: () => (
    <div style={{ width: "600px" }}>
      <Card style={{ padding: "2rem" }}>
        {/* Header Section */}
        <div style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start" }}>
          <div style={{ position: "relative" }}>
            <Avatar.Root style={{ width: "96px", height: "96px", fontSize: "2rem" }}>
              <Avatar.Image src="https://i.pravatar.cc/150?u=sarah" alt="Sarah Chen" />
              <Avatar.Fallback>SC</Avatar.Fallback>
            </Avatar.Root>
            <button
              aria-label="Change profile photo"
              style={{
                position: "absolute",
                bottom: "0",
                right: "0",
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                backgroundColor: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
                border: "2px solid hsl(var(--background))",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <CameraIcon />
            </button>
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                marginBottom: "0.25rem",
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: "1.5rem",
                  fontWeight: 600,
                  color: "hsl(var(--foreground))",
                }}
              >
                Sarah Chen
              </h2>
              <Badge>Pro</Badge>
            </div>
            <p
              style={{
                margin: "0 0 0.75rem",
                color: "hsl(var(--muted-foreground))",
                fontSize: "0.875rem",
              }}
            >
              @sarahchen
            </p>
            <p
              style={{
                margin: 0,
                color: "hsl(var(--foreground))",
                fontSize: "0.875rem",
                lineHeight: 1.5,
              }}
            >
              Product designer passionate about creating intuitive user experiences. Currently
              leading design at TechCorp.
            </p>
          </div>
        </div>

        {/* Info Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "1rem",
            marginTop: "1.5rem",
            padding: "1rem",
            backgroundColor: "hsl(var(--muted))",
            borderRadius: "var(--radius)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              color: "hsl(var(--muted-foreground))",
              fontSize: "0.875rem",
            }}
          >
            <MailIcon />
            <span>sarah.chen@email.com</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              color: "hsl(var(--muted-foreground))",
              fontSize: "0.875rem",
            }}
          >
            <MapPinIcon />
            <span>San Francisco, CA</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              color: "hsl(var(--muted-foreground))",
              fontSize: "0.875rem",
            }}
          >
            <CalendarIcon />
            <span>Joined March 2023</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              color: "hsl(var(--muted-foreground))",
              fontSize: "0.875rem",
            }}
          >
            <LinkIcon />
            <a href="#" style={{ color: "hsl(var(--primary))", textDecoration: "none" }}>
              sarahchen.design
            </a>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
          <Button style={{ flex: 1 }}>Edit Profile</Button>
          <Button variant="outline" style={{ flex: 1 }}>
            Share Profile
          </Button>
        </div>
      </Card>
    </div>
  ),
};

export const WithTabs: Story = {
  name: "Profile with Tabs",
  render: () => {
    const [activeTab, setActiveTab] = React.useState("profile");

    return (
      <div style={{ width: "700px" }}>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {/* Cover Image */}
          <div
            style={{
              height: "120px",
              background:
                "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.7) 100%)",
            }}
          />

          {/* Profile Header */}
          <div style={{ padding: "0 2rem 1.5rem", marginTop: "-48px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-end",
              }}
            >
              <Avatar.Root
                style={{
                  width: "96px",
                  height: "96px",
                  fontSize: "2rem",
                  border: "4px solid hsl(var(--background))",
                }}
              >
                <Avatar.Image src="https://i.pravatar.cc/150?u=alex" alt="Alex Johnson" />
                <Avatar.Fallback>AJ</Avatar.Fallback>
              </Avatar.Root>
              <Button size="sm">Edit Profile</Button>
            </div>

            <div style={{ marginTop: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: "1.25rem",
                    fontWeight: 600,
                    color: "hsl(var(--foreground))",
                  }}
                >
                  Alex Johnson
                </h2>
                <CheckIcon />
              </div>
              <p
                style={{
                  margin: "0.25rem 0 0",
                  color: "hsl(var(--muted-foreground))",
                  fontSize: "0.875rem",
                }}
              >
                Senior Software Engineer at StartupXYZ
              </p>
            </div>
          </div>

          <Separator />

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList
              style={{
                padding: "0 2rem",
                justifyContent: "flex-start",
                gap: "2rem",
              }}
            >
              <Tab value="profile">Profile</Tab>
              <Tab value="activity">Activity</Tab>
              <Tab value="settings">Settings</Tab>
            </TabsList>

            <TabPanel value="profile" style={{ padding: "1.5rem 2rem" }}>
              <div style={{ display: "grid", gap: "1.5rem" }}>
                <div>
                  <h3
                    style={{
                      margin: "0 0 0.75rem",
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      color: "hsl(var(--foreground))",
                    }}
                  >
                    About
                  </h3>
                  <p
                    style={{
                      margin: 0,
                      color: "hsl(var(--muted-foreground))",
                      fontSize: "0.875rem",
                      lineHeight: 1.6,
                    }}
                  >
                    Full-stack developer with 8+ years of experience building scalable web
                    applications. Passionate about clean code, developer experience, and mentoring
                    junior engineers. When not coding, you can find me hiking or playing chess.
                  </p>
                </div>

                <div>
                  <h3
                    style={{
                      margin: "0 0 0.75rem",
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      color: "hsl(var(--foreground))",
                    }}
                  >
                    Skills
                  </h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    {["React", "TypeScript", "Node.js", "PostgreSQL", "AWS", "GraphQL"].map(
                      (skill) => (
                        <Badge key={skill} color="neutral">
                          {skill}
                        </Badge>
                      ),
                    )}
                  </div>
                </div>

                <div>
                  <h3
                    style={{
                      margin: "0 0 0.75rem",
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      color: "hsl(var(--foreground))",
                    }}
                  >
                    Contact
                  </h3>
                  <div style={{ display: "grid", gap: "0.5rem" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        color: "hsl(var(--muted-foreground))",
                        fontSize: "0.875rem",
                      }}
                    >
                      <MailIcon />
                      <span>alex.johnson@email.com</span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        color: "hsl(var(--muted-foreground))",
                        fontSize: "0.875rem",
                      }}
                    >
                      <MapPinIcon />
                      <span>Austin, TX</span>
                    </div>
                  </div>
                </div>
              </div>
            </TabPanel>

            <TabPanel value="activity" style={{ padding: "1.5rem 2rem" }}>
              <p
                style={{
                  color: "hsl(var(--muted-foreground))",
                  fontSize: "0.875rem",
                }}
              >
                Recent activity will appear here...
              </p>
            </TabPanel>

            <TabPanel value="settings" style={{ padding: "1.5rem 2rem" }}>
              <p
                style={{
                  color: "hsl(var(--muted-foreground))",
                  fontSize: "0.875rem",
                }}
              >
                Account settings will appear here...
              </p>
            </TabPanel>
          </Tabs>
        </Card>
      </div>
    );
  },
};

export const EditableProfile: Story = {
  name: "Editable Profile Form",
  render: () => {
    const [formData, setFormData] = React.useState({
      firstName: "Emily",
      lastName: "Rodriguez",
      email: "emily.rodriguez@email.com",
      username: "emilyrodriguez",
      bio: "Marketing specialist with a focus on growth strategies and brand development. Love exploring new places and trying different cuisines.",
      location: "New York, NY",
      website: "https://emilyrodriguez.com",
      timezone: "America/New_York",
    });

    const handleChange = (field: string, value: string) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
    };

    return (
      <div style={{ width: "600px" }}>
        <Card style={{ padding: "2rem" }}>
          <h2
            style={{
              margin: "0 0 1.5rem",
              fontSize: "1.25rem",
              fontWeight: 600,
              color: "hsl(var(--foreground))",
            }}
          >
            Edit Profile
          </h2>

          {/* Avatar Section */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "1.5rem",
              marginBottom: "2rem",
            }}
          >
            <Avatar.Root style={{ width: "80px", height: "80px", fontSize: "1.5rem" }}>
              <Avatar.Image src="https://i.pravatar.cc/150?u=emily" alt="Emily Rodriguez" />
              <Avatar.Fallback>ER</Avatar.Fallback>
            </Avatar.Root>
            <div>
              <Button variant="outline" size="sm" style={{ marginBottom: "0.5rem" }}>
                Change Photo
              </Button>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.75rem",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                JPG, PNG or GIF. Max size 2MB.
              </p>
            </div>
          </div>

          <Separator style={{ marginBottom: "1.5rem" }} />

          {/* Form Fields */}
          <div style={{ display: "grid", gap: "1.25rem" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1rem",
              }}
            >
              <div>
                <Label htmlFor="firstName" style={{ display: "block", marginBottom: "0.5rem" }}>
                  First Name
                </Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={(e) => handleChange("firstName", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="lastName" style={{ display: "block", marginBottom: "0.5rem" }}>
                  Last Name
                </Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={(e) => handleChange("lastName", e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="email" style={{ display: "block", marginBottom: "0.5rem" }}>
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleChange("email", e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="username" style={{ display: "block", marginBottom: "0.5rem" }}>
                Username
              </Label>
              <div style={{ position: "relative" }}>
                <span
                  style={{
                    position: "absolute",
                    left: "0.75rem",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "hsl(var(--muted-foreground))",
                    fontSize: "0.875rem",
                  }}
                >
                  @
                </span>
                <Input
                  id="username"
                  value={formData.username}
                  onChange={(e) => handleChange("username", e.target.value)}
                  style={{ paddingLeft: "1.75rem" }}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="bio" style={{ display: "block", marginBottom: "0.5rem" }}>
                Bio
              </Label>
              <textarea
                id="bio"
                value={formData.bio}
                onChange={(e) => handleChange("bio", e.target.value)}
                rows={3}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.875rem",
                  fontFamily: "inherit",
                  border: "1px solid hsl(var(--input))",
                  borderRadius: "var(--radius)",
                  backgroundColor: "hsl(var(--background))",
                  color: "hsl(var(--foreground))",
                  resize: "vertical",
                }}
              />
              <p
                style={{
                  margin: "0.25rem 0 0",
                  fontSize: "0.75rem",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                Brief description for your profile. Max 160 characters.
              </p>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1rem",
              }}
            >
              <div>
                <Label htmlFor="location" style={{ display: "block", marginBottom: "0.5rem" }}>
                  Location
                </Label>
                <Input
                  id="location"
                  value={formData.location}
                  onChange={(e) => handleChange("location", e.target.value)}
                  placeholder="City, Country"
                />
              </div>
              <div>
                <Label htmlFor="website" style={{ display: "block", marginBottom: "0.5rem" }}>
                  Website
                </Label>
                <Input
                  id="website"
                  value={formData.website}
                  onChange={(e) => handleChange("website", e.target.value)}
                  placeholder="https://"
                />
              </div>
            </div>

            <div>
              <Label style={{ display: "block", marginBottom: "0.5rem" }}>Timezone</Label>
              <Select defaultValue="America/New_York">
                <SelectTrigger style={{ width: "100%" }} aria-label="Timezone">
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectPortal>
                  <SelectPositioner sideOffset={4}>
                    <SelectPopup>
                      <SelectList>
                        <SelectOption value="America/Los_Angeles">Pacific Time (PT)</SelectOption>
                        <SelectOption value="America/Denver">Mountain Time (MT)</SelectOption>
                        <SelectOption value="America/Chicago">Central Time (CT)</SelectOption>
                        <SelectOption value="America/New_York">Eastern Time (ET)</SelectOption>
                        <SelectOption value="Europe/London">London (GMT)</SelectOption>
                        <SelectOption value="Europe/Paris">Paris (CET)</SelectOption>
                        <SelectOption value="Asia/Tokyo">Tokyo (JST)</SelectOption>
                      </SelectList>
                    </SelectPopup>
                  </SelectPositioner>
                </SelectPortal>
              </Select>
            </div>
          </div>

          <Separator style={{ margin: "1.5rem 0" }} />

          {/* Actions */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "0.75rem",
            }}
          >
            <Button variant="ghost">Cancel</Button>
            <Button>Save Changes</Button>
          </div>
        </Card>
      </div>
    );
  },
};

function PreferenceRow({
  label,
  description,
  checked,
  onToggle,
}: {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "1rem 0",
      }}
    >
      <div>
        <p
          style={{
            margin: 0,
            fontWeight: 500,
            color: "hsl(var(--foreground))",
            fontSize: "0.875rem",
          }}
        >
          {label}
        </p>
        <p
          style={{
            margin: "0.25rem 0 0",
            color: "hsl(var(--muted-foreground))",
            fontSize: "0.75rem",
          }}
        >
          {description}
        </p>
      </div>
      <Switch checked={checked} onCheckedChange={onToggle} aria-label="Toggle switch">
        <SwitchThumb />
      </Switch>
    </div>
  );
}

export const PreferencesPage: Story = {
  name: "User Preferences",
  render: () => {
    const [preferences, setPreferences] = React.useState({
      emailNotifications: true,
      pushNotifications: false,
      weeklyDigest: true,
      marketingEmails: false,
      profilePublic: true,
      showEmail: false,
      showLocation: true,
      twoFactor: false,
    });

    const togglePreference = (key: keyof typeof preferences) => {
      setPreferences((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    return (
      <div style={{ width: "600px", display: "grid", gap: "1.5rem" }}>
        {/* Notifications */}
        <Card style={{ padding: "1.5rem" }}>
          <h3
            style={{
              margin: "0 0 0.5rem",
              fontSize: "1rem",
              fontWeight: 600,
              color: "hsl(var(--foreground))",
            }}
          >
            Notifications
          </h3>
          <p
            style={{
              margin: "0 0 1rem",
              color: "hsl(var(--muted-foreground))",
              fontSize: "0.875rem",
            }}
          >
            Manage how you receive notifications.
          </p>

          <PreferenceRow
            label="Email Notifications"
            description="Receive email notifications for important updates"
            checked={preferences.emailNotifications}
            onToggle={() => togglePreference("emailNotifications")}
          />
          <Separator />
          <PreferenceRow
            label="Push Notifications"
            description="Receive push notifications on your devices"
            checked={preferences.pushNotifications}
            onToggle={() => togglePreference("pushNotifications")}
          />
          <Separator />
          <PreferenceRow
            label="Weekly Digest"
            description="Get a weekly summary of your activity"
            checked={preferences.weeklyDigest}
            onToggle={() => togglePreference("weeklyDigest")}
          />
          <Separator />
          <PreferenceRow
            label="Marketing Emails"
            description="Receive emails about new features and offers"
            checked={preferences.marketingEmails}
            onToggle={() => togglePreference("marketingEmails")}
          />
        </Card>

        {/* Privacy */}
        <Card style={{ padding: "1.5rem" }}>
          <h3
            style={{
              margin: "0 0 0.5rem",
              fontSize: "1rem",
              fontWeight: 600,
              color: "hsl(var(--foreground))",
            }}
          >
            Privacy
          </h3>
          <p
            style={{
              margin: "0 0 1rem",
              color: "hsl(var(--muted-foreground))",
              fontSize: "0.875rem",
            }}
          >
            Control who can see your information.
          </p>

          <PreferenceRow
            label="Public Profile"
            description="Allow others to view your profile"
            checked={preferences.profilePublic}
            onToggle={() => togglePreference("profilePublic")}
          />
          <Separator />
          <PreferenceRow
            label="Show Email"
            description="Display your email on your public profile"
            checked={preferences.showEmail}
            onToggle={() => togglePreference("showEmail")}
          />
          <Separator />
          <PreferenceRow
            label="Show Location"
            description="Display your location on your public profile"
            checked={preferences.showLocation}
            onToggle={() => togglePreference("showLocation")}
          />
        </Card>

        {/* Security */}
        <Card style={{ padding: "1.5rem" }}>
          <h3
            style={{
              margin: "0 0 0.5rem",
              fontSize: "1rem",
              fontWeight: 600,
              color: "hsl(var(--foreground))",
            }}
          >
            Security
          </h3>
          <p
            style={{
              margin: "0 0 1rem",
              color: "hsl(var(--muted-foreground))",
              fontSize: "0.875rem",
            }}
          >
            Manage your account security settings.
          </p>

          <PreferenceRow
            label="Two-Factor Authentication"
            description="Add an extra layer of security to your account"
            checked={preferences.twoFactor}
            onToggle={() => togglePreference("twoFactor")}
          />
          <Separator />
          <div style={{ padding: "1rem 0" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <p
                  style={{
                    margin: 0,
                    fontWeight: 500,
                    color: "hsl(var(--foreground))",
                    fontSize: "0.875rem",
                  }}
                >
                  Change Password
                </p>
                <p
                  style={{
                    margin: "0.25rem 0 0",
                    color: "hsl(var(--muted-foreground))",
                    fontSize: "0.75rem",
                  }}
                >
                  Last changed 3 months ago
                </p>
              </div>
              <Button variant="outline" size="sm">
                Update
              </Button>
            </div>
          </div>
          <Separator />
          <div style={{ padding: "1rem 0" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <p
                  style={{
                    margin: 0,
                    fontWeight: 500,
                    color: "hsl(var(--destructive))",
                    fontSize: "0.875rem",
                  }}
                >
                  Delete Account
                </p>
                <p
                  style={{
                    margin: "0.25rem 0 0",
                    color: "hsl(var(--muted-foreground))",
                    fontSize: "0.75rem",
                  }}
                >
                  Permanently delete your account and all data
                </p>
              </div>
              <Button color="destructive" size="sm">
                Delete
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  },
};

export const CompactProfile: Story = {
  name: "Compact Profile Card",
  render: () => (
    <div style={{ width: "320px" }}>
      <Card style={{ padding: "1.5rem", textAlign: "center" }}>
        <Avatar.Root
          style={{
            width: "80px",
            height: "80px",
            fontSize: "1.5rem",
            margin: "0 auto 1rem",
          }}
        >
          <Avatar.Image src="https://i.pravatar.cc/150?u=michael" alt="Michael Park" />
          <Avatar.Fallback>MP</Avatar.Fallback>
        </Avatar.Root>

        <h3
          style={{
            margin: "0 0 0.25rem",
            fontSize: "1.125rem",
            fontWeight: 600,
            color: "hsl(var(--foreground))",
          }}
        >
          Michael Park
        </h3>
        <p
          style={{
            margin: "0 0 0.5rem",
            color: "hsl(var(--muted-foreground))",
            fontSize: "0.875rem",
          }}
        >
          @michaelpark
        </p>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "0.5rem",
            marginBottom: "1rem",
          }}
        >
          <Badge color="neutral">Developer</Badge>
          <Badge>Premium</Badge>
        </div>

        <p
          style={{
            margin: "0 0 1.25rem",
            color: "hsl(var(--foreground))",
            fontSize: "0.875rem",
            lineHeight: 1.5,
          }}
        >
          Building the future of developer tools. Open source enthusiast.
        </p>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "2rem",
            padding: "1rem 0",
            borderTop: "1px solid hsl(var(--border))",
            borderBottom: "1px solid hsl(var(--border))",
            marginBottom: "1.25rem",
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                fontWeight: 600,
                fontSize: "1.125rem",
                color: "hsl(var(--foreground))",
              }}
            >
              128
            </p>
            <p
              style={{
                margin: 0,
                color: "hsl(var(--muted-foreground))",
                fontSize: "0.75rem",
              }}
            >
              Projects
            </p>
          </div>
          <div>
            <p
              style={{
                margin: 0,
                fontWeight: 600,
                fontSize: "1.125rem",
                color: "hsl(var(--foreground))",
              }}
            >
              2.4K
            </p>
            <p
              style={{
                margin: 0,
                color: "hsl(var(--muted-foreground))",
                fontSize: "0.75rem",
              }}
            >
              Followers
            </p>
          </div>
          <div>
            <p
              style={{
                margin: 0,
                fontWeight: 600,
                fontSize: "1.125rem",
                color: "hsl(var(--foreground))",
              }}
            >
              847
            </p>
            <p
              style={{
                margin: 0,
                color: "hsl(var(--muted-foreground))",
                fontSize: "0.75rem",
              }}
            >
              Following
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <Button style={{ flex: 1 }}>Follow</Button>
          <Button variant="outline" style={{ flex: 1 }}>
            Message
          </Button>
        </div>
      </Card>
    </div>
  ),
};

export const AccountOverview: Story = {
  name: "Account Overview",
  render: () => (
    <div style={{ width: "800px" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1
          style={{
            margin: "0 0 0.5rem",
            fontSize: "1.5rem",
            fontWeight: 600,
            color: "hsl(var(--foreground))",
          }}
        >
          Account
        </h1>
        <p
          style={{
            margin: 0,
            color: "hsl(var(--muted-foreground))",
            fontSize: "0.875rem",
          }}
        >
          Manage your account settings and preferences.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "200px 1fr",
          gap: "2rem",
        }}
      >
        {/* Sidebar */}
        <NavigationMenu.Root>
          <NavigationMenu.List style={{ flexDirection: "column", alignItems: "stretch" }}>
            {[
              { label: "Profile", href: "#profile", active: true },
              { label: "Account", href: "#account", active: false },
              { label: "Notifications", href: "#notifications", active: false },
              { label: "Privacy", href: "#privacy", active: false },
              { label: "Security", href: "#security", active: false },
              { label: "Billing", href: "#billing", active: false },
            ].map((item) => (
              <NavigationMenu.Item key={item.label}>
                <NavigationMenu.Link href={item.href} data-active={item.active || undefined}>
                  {item.label}
                </NavigationMenu.Link>
              </NavigationMenu.Item>
            ))}
          </NavigationMenu.List>
        </NavigationMenu.Root>

        {/* Content */}
        <Card style={{ padding: "1.5rem" }}>
          <h2
            style={{
              margin: "0 0 0.5rem",
              fontSize: "1.125rem",
              fontWeight: 600,
              color: "hsl(var(--foreground))",
            }}
          >
            Profile
          </h2>
          <p
            style={{
              margin: "0 0 1.5rem",
              color: "hsl(var(--muted-foreground))",
              fontSize: "0.875rem",
            }}
          >
            This information will be displayed publicly.
          </p>

          {/* Profile Photo */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "1.5rem",
              marginBottom: "1.5rem",
            }}
          >
            <Avatar.Root style={{ width: "64px", height: "64px", fontSize: "1.25rem" }}>
              <Avatar.Image src="https://i.pravatar.cc/150?u=lisa" alt="Lisa Wang" />
              <Avatar.Fallback>LW</Avatar.Fallback>
            </Avatar.Root>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <Button variant="outline" size="sm">
                Change
              </Button>
              <Button variant="ghost" size="sm">
                Remove
              </Button>
            </div>
          </div>

          <Separator style={{ marginBottom: "1.5rem" }} />

          {/* Form */}
          <div style={{ display: "grid", gap: "1.25rem" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr",
                gap: "1rem",
                alignItems: "center",
              }}
            >
              <Label htmlFor="account-fullname">Full Name</Label>
              <Input id="account-fullname" defaultValue="Lisa Wang" />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr",
                gap: "1rem",
                alignItems: "center",
              }}
            >
              <Label htmlFor="account-email">Email</Label>
              <Input id="account-email" defaultValue="lisa.wang@company.com" type="email" />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr",
                gap: "1rem",
                alignItems: "start",
              }}
            >
              <Label htmlFor="account-bio" style={{ paddingTop: "0.5rem" }}>
                Bio
              </Label>
              <div>
                <textarea
                  id="account-bio"
                  defaultValue="Product manager passionate about user research and data-driven decisions."
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.75rem",
                    fontSize: "0.875rem",
                    fontFamily: "inherit",
                    border: "1px solid hsl(var(--input))",
                    borderRadius: "var(--radius)",
                    backgroundColor: "hsl(var(--background))",
                    color: "hsl(var(--foreground))",
                    resize: "vertical",
                  }}
                />
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr",
                gap: "1rem",
                alignItems: "center",
              }}
            >
              <Label htmlFor="account-role">Role</Label>
              <Input id="account-role" defaultValue="Product Manager" />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr",
                gap: "1rem",
                alignItems: "center",
              }}
            >
              <Label htmlFor="account-company">Company</Label>
              <Input id="account-company" defaultValue="TechCorp Inc." />
            </div>
          </div>

          <Separator style={{ margin: "1.5rem 0" }} />

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "0.75rem",
            }}
          >
            <Button variant="ghost">Cancel</Button>
            <Button>Save</Button>
          </div>
        </Card>
      </div>
    </div>
  ),
};
