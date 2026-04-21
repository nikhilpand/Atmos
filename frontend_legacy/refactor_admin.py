import re

with open('admin.html', 'r', encoding='utf-8') as f:
    html = f.read()

# 1. Update Sidebar Navigation
old_nav = """            <nav class="sidebar-nav">
                <div class="nav-group-label">Main</div>
                <button class="nav-item active" data-panel="panel-overview"><i data-lucide="layout-dashboard"></i><span>Overview</span></button>
                <button class="nav-item" data-panel="panel-discover"><i data-lucide="search"></i><span>Discover</span></button>
                <button class="nav-item" data-panel="panel-library"><i data-lucide="folder-open"></i><span>Library</span></button>
                <button class="nav-item" data-panel="panel-transfers"><i data-lucide="cloud-upload"></i><span>Active Jobs</span><span class="nav-badge" id="navTransferBadge" style="display:none">0</span></button>

                <div class="nav-group-label">Management</div>
                <button class="nav-item" data-panel="panel-drive"><i data-lucide="hard-drive"></i><span>Drive Explorer</span></button>
                <button class="nav-item" data-panel="panel-bulk"><i data-lucide="layers"></i><span>Bulk Ops</span></button>
                <button class="nav-item" data-panel="panel-scheduler"><i data-lucide="calendar-clock"></i><span>Scheduler</span></button>

                <div class="nav-group-label">Monitoring</div>
                <button class="nav-item" data-panel="panel-console"><i data-lucide="terminal"></i><span>Console</span></button>
                <button class="nav-item" data-panel="panel-health"><i data-lucide="activity"></i><span>Health</span></button>
                <button class="nav-item" data-panel="panel-analytics"><i data-lucide="bar-chart-3"></i><span>Analytics</span></button>
                <button class="nav-item" data-panel="panel-feed"><i data-lucide="rss"></i><span>Activity Feed</span></button>

                <div class="nav-group-label">System</div>
                <button class="nav-item" data-panel="panel-telegram"><i data-lucide="send"></i><span>Telegram</span></button>
                <button class="nav-item" data-panel="panel-config"><i data-lucide="settings"></i><span>Config</span></button>
                <button class="nav-item" data-panel="panel-appearance"><i data-lucide="palette"></i><span>Appearance</span></button>
            </nav>"""

new_nav = """            <nav class="sidebar-nav">
                <div class="nav-group">
                    <button class="nav-item active" data-panel="panel-overview"><i data-lucide="layout-dashboard"></i><span>Overview</span></button>
                    <div class="nav-sub-items">
                        <button class="nav-item sub-item" data-panel="panel-analytics"><i data-lucide="bar-chart-3"></i><span>Analytics</span></button>
                    </div>
                </div>

                <div class="nav-group">
                    <button class="nav-item" data-panel="panel-library"><i data-lucide="folder-open"></i><span>Media Library</span></button>
                    <div class="nav-sub-items">
                        <button class="nav-item sub-item" data-panel="panel-drive"><i data-lucide="hard-drive"></i><span>Drive Explorer</span></button>
                    </div>
                </div>

                <div class="nav-group">
                    <button class="nav-item" data-panel="panel-discover"><i data-lucide="search"></i><span>Discover & Batch</span></button>
                    <div class="nav-sub-items">
                        <button class="nav-item sub-item" data-panel="panel-bulk"><i data-lucide="layers"></i><span>Bulk Ops</span></button>
                    </div>
                </div>

                <div class="nav-group">
                    <button class="nav-item" data-panel="panel-transfers"><i data-lucide="cloud-upload"></i><span>Operations</span><span class="nav-badge" id="navTransferBadge" style="display:none">0</span></button>
                    <div class="nav-sub-items">
                        <button class="nav-item sub-item" data-panel="panel-scheduler"><i data-lucide="calendar-clock"></i><span>Scheduler</span></button>
                    </div>
                </div>

                <div class="nav-group">
                    <button class="nav-item" data-panel="panel-console"><i data-lucide="terminal"></i><span>System Health</span></button>
                    <div class="nav-sub-items">
                        <button class="nav-item sub-item" data-panel="panel-feed"><i data-lucide="rss"></i><span>Activity Feed</span></button>
                        <button class="nav-item sub-item" data-panel="panel-health"><i data-lucide="activity"></i><span>Health Monitor</span></button>
                    </div>
                </div>

                <div class="nav-group">
                    <button class="nav-item" data-panel="panel-config"><i data-lucide="settings"></i><span>Settings</span></button>
                    <div class="nav-sub-items">
                        <button class="nav-item sub-item" data-panel="panel-appearance"><i data-lucide="palette"></i><span>Appearance</span></button>
                        <button class="nav-item sub-item" data-panel="panel-telegram"><i data-lucide="send"></i><span>Telegram Bot</span></button>
                    </div>
                </div>
            </nav>"""

if old_nav in html:
    html = html.replace(old_nav, new_nav)
    print("Replaced nav!")
else:
    print("Could not find exact old_nav block")

with open('admin.html', 'w', encoding='utf-8') as f:
    f.write(html)
