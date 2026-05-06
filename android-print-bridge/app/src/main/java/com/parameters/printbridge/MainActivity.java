package com.parameters.printbridge;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public class MainActivity extends Activity {
    private static final String PREFS = "print_bridge";
    private static final String PREF_PRINTER_MAC = "printer_mac";
    private Spinner printerSpinner;
    private TextView statusView;
    private final List<BluetoothDevice> pairedDevices = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildUi();
        requestBluetoothPermission();
        loadPairedPrinters();
        handleIncomingIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(28, 28, 28, 28);

        TextView title = new TextView(this);
        title.setText("92 Print Bridge");
        title.setTextSize(24);
        title.setTypeface(null, 1);
        root.addView(title);

        TextView hint = new TextView(this);
        hint.setText("Pair the 58mm Bluetooth printer in Android settings, then select it here.");
        hint.setPadding(0, 12, 0, 16);
        root.addView(hint);

        printerSpinner = new Spinner(this);
        root.addView(printerSpinner);

        Button refresh = new Button(this);
        refresh.setText("Refresh Paired Printers");
        refresh.setOnClickListener(v -> loadPairedPrinters());
        root.addView(refresh);

        Button save = new Button(this);
        save.setText("Save Printer");
        save.setOnClickListener(v -> saveSelectedPrinter());
        root.addView(save);

        Button test = new Button(this);
        test.setText("Test Print");
        test.setOnClickListener(v -> printJson(sampleReceipt()));
        root.addView(test);

        Button settings = new Button(this);
        settings.setText("Open Bluetooth Settings");
        settings.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS)));
        root.addView(settings);

        statusView = new TextView(this);
        statusView.setInputType(InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        statusView.setPadding(0, 18, 0, 0);
        root.addView(statusView);

        setContentView(root);
    }

    private void requestBluetoothPermission() {
        if (Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, 92);
        }
    }

    private boolean hasBluetoothPermission() {
        return Build.VERSION.SDK_INT < 31 || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    private void loadPairedPrinters() {
        pairedDevices.clear();
        List<String> labels = new ArrayList<>();
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            setStatus("Bluetooth is not available.");
            return;
        }
        if (!hasBluetoothPermission()) {
            setStatus("Bluetooth permission is required.");
            return;
        }
        Set<BluetoothDevice> bonded = adapter.getBondedDevices();
        String savedMac = getPrefs().getString(PREF_PRINTER_MAC, "");
        int selectedIndex = 0;
        int i = 0;
        for (BluetoothDevice device : bonded) {
            pairedDevices.add(device);
            labels.add(device.getName() + " (" + device.getAddress() + ")");
            if (device.getAddress().equals(savedMac)) selectedIndex = i;
            i++;
        }
        if (labels.isEmpty()) labels.add("No paired Bluetooth printers found");
        printerSpinner.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, labels));
        if (!pairedDevices.isEmpty()) printerSpinner.setSelection(selectedIndex);
        setStatus("Found " + pairedDevices.size() + " paired Bluetooth device(s).");
    }

    private void saveSelectedPrinter() {
        BluetoothDevice device = getSelectedPrinter();
        if (device == null) {
            setStatus("No printer selected.");
            return;
        }
        getPrefs().edit().putString(PREF_PRINTER_MAC, device.getAddress()).apply();
        setStatus("Saved printer: " + device.getName());
    }

    private BluetoothDevice getSelectedPrinter() {
        if (pairedDevices.isEmpty()) return null;
        int index = printerSpinner.getSelectedItemPosition();
        if (index < 0 || index >= pairedDevices.size()) return pairedDevices.get(0);
        return pairedDevices.get(index);
    }

    private String getSavedPrinterMac() {
        String saved = getPrefs().getString(PREF_PRINTER_MAC, "");
        if (!saved.isEmpty()) return saved;
        BluetoothDevice selected = getSelectedPrinter();
        return selected == null ? "" : selected.getAddress();
    }

    private void handleIncomingIntent(Intent intent) {
        try {
            if (intent == null) return;
            String payload = null;
            if (Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
                Uri uri = intent.getData();
                payload = uri.getQueryParameter("payload");
            } else if (Intent.ACTION_SEND.equals(intent.getAction())) {
                payload = intent.getStringExtra(Intent.EXTRA_TEXT);
            }
            if (payload == null || payload.trim().isEmpty()) return;
            printJson(new JSONObject(payload));
        } catch (Exception e) {
            setStatus("Could not read print job: " + e.getMessage());
        }
    }

    private void printJson(JSONObject receipt) {
        String mac = getSavedPrinterMac();
        if (mac.isEmpty()) {
            setStatus("Select and save a paired printer first.");
            return;
        }
        setStatus("Printing...");
        new Thread(() -> {
            try {
                EscPosPrinter.printReceipt(this, mac, receipt);
                runOnUiThread(() -> {
                    setStatus("Print job sent.");
                    Toast.makeText(this, "Printed", Toast.LENGTH_SHORT).show();
                });
            } catch (Exception e) {
                runOnUiThread(() -> setStatus("Print failed: " + e.getMessage()));
            }
        }).start();
    }

    private JSONObject sampleReceipt() {
        try {
            JSONObject receipt = new JSONObject();
            receipt.put("receiptNo", "TEST-" + System.currentTimeMillis());
            receipt.put("businessName", "92 PARAMETERS CAFE");
            receipt.put("datetimeText", new SimpleDateFormat("MMM d, yyyy h:mm a", Locale.US).format(new Date()));
            receipt.put("orderType", "Dine In");
            receipt.put("paymentMethod", "Cash");
            receipt.put("staffName", "Test Staff");
            JSONArray items = new JSONArray();
            items.put(new JSONObject().put("name", "Flat White Iced").put("quantity", 1).put("lineTotal", 195));
            items.put(new JSONObject().put("name", "Dark Chocolate Hot").put("quantity", 1).put("lineTotal", 180));
            receipt.put("items", items);
            receipt.put("subtotal", 375);
            receipt.put("total", 375);
            receipt.put("cashReceived", 500);
            receipt.put("change", 125);
            receipt.put("footer", "THANK YOU! SEE US AGAIN! :)");
            return receipt;
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private SharedPreferences getPrefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private void setStatus(String message) {
        statusView.setText(message);
    }
}
